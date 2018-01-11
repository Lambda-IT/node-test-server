import { configuration } from './config';
import { notifySlack } from './http-service';

import * as _ from 'lodash';
import * as simpleGit from 'simple-git';
import * as simpleGitP from 'simple-git/promise';
import { Observable, BehaviorSubject } from 'rxjs';
import { exec } from 'child_process';
import * as Promise from 'bluebird';
import * as fsExtra from 'fs-extra';

interface Branch {
    name: string,
    commit: string,
    label: string
}

const fs: any = Promise.promisifyAll(fsExtra);

type BuildTask = {
    [name: string]: string[]
};
type TaskProgress = {
    [name: string]: {
        done: boolean;
        error: any;
    }
};
enum DeploySteps {
    Build,
    Test,
    Deploy,
    PostDeploy,
    Restart
}

function execParallel(buildTasks: BuildTask, buildPath: string) {
    const tasks = Object.keys(buildTasks);
    const progress: TaskProgress = tasks.reduce((acc, task) => ({...acc, [task]: { done: false }}), {});
    return Promise
        .mapSeries(tasks, task => {
                return Promise.map(buildTasks[task], command => execAsync(command, buildPath))
                    .then(result => {
                        console.log(`[deploy] ${task} - Completed`);
                        progress[task].done = true;
                        return result;
                    })
                    .catch(error => {
                        console.error(`[deploy] ${task} - failed`, error);
                        progress[task].error = error;
                        throw progress;
                    })
        })
        .then(results => results.reduce((acc, cur) => [...acc, ...cur], []))
        .catch((error) => {
            throw { aggregateErrors: error };
        })
}

function execAsync(args, buildPath: string | null = null) {
    return new Promise(function (resolve, reject) {
        function callback(err, stdout, stderr) {
            if (err) {
                const commandStr = args[0] + (Array.isArray(args[1]) ? (' ' + args[1].join(' ')) : '');
                err.message += ' `' + commandStr + '` (exited with error code ' + err.code + ')';
                err.stdout = stdout;
                err.stderr = stderr;
                const cpError = {
                    error: err,
                    stdout: stdout,
                    stderr: stderr
                };
                reject(cpError);
            } else {
                resolve({
                    stdout: stdout,
                    stderr: stderr
                });
            }
        }

        const cp = exec(args, { cwd: buildPath }, callback);
    });
}

function deployFilterFunc(src, dest) {
    return src.indexOf('node_modules') < 0 && src.indexOf('.git') < 0;
}

function getCurrentBranch() {
    return new Promise((resolve, reject) => {
        simpleGit(configuration.path).branch((error, result) => {
            if (error) {
                reject(error);
            }
            else {
                resolve(result.branches[result.current]);
            }
        });
    })
}

const processing$ = new BehaviorSubject(false);

Observable
    .interval(configuration.poll * 1000)
    .withLatestFrom(processing$.asObservable(), (i, isProcessing) => isProcessing)
    .filter(isProcessing => !isProcessing)
    .startWith(false)
    .flatMap(() => {
        console.log(`[git] ${new Date().toTimeString()} Fetching from remote`);
        const repo = simpleGitP(configuration.path);
        return repo.fetch()
            .then(x => repo.status().then(status => status.behind))
            .then(behind => {
                console.log(`[git] Repository is ${behind} commit(s) behind`);
                if (behind > 0 || configuration.isDebug) {
                    processing$.next(true);
                    console.log(`[git] Pulling from remote`);
                    return repo.pull()
                        .then(() => getCurrentBranch())
                        .then(branch => build(branch));
                }
            })
    })
    .subscribe();

processing$.asObservable().skip(1).subscribe(x => { console.log('[deploy] Processing state changed:', x); });

function build(branch) {
    const deploySteps = [DeploySteps.Build, DeploySteps.Test, DeploySteps.Deploy, DeploySteps.PostDeploy, DeploySteps.Restart];
    let currentStep: DeploySteps = DeploySteps.Build;

    console.log(`[deploy] Start processing`, branch);
    return Promise.resolve()
        .then(() => {
            return execParallel(configuration.buildScript, configuration.buildPath);
        })
        .then((buildResult: any) => {
            console.log('[deploy] Build done');
            console.log('[deploy] BuildResult:', buildResult);
            console.log('[deploy] ######################');
        })
        .then(() => {
            currentStep = DeploySteps.Test;
            return execParallel(configuration.testScript, configuration.buildPath);
        })
        .then((testResult: any) => {
            console.log('[deploy] Testing done');
            console.log('[deploy] TestResult:', testResult);
            console.log('[deploy] ######################');
        })
        .then(() => {
            currentStep = DeploySteps.Deploy;
            return execAsync(`rsync -rtl ${configuration.buildPath} ${configuration.deployPath}`);
        })
        .then((deployResult: any) => {
            console.log('[deploy] Deploying done');
            console.log('[deploy] DeployResult:', deployResult);
        })
        .then(() => {
            currentStep = DeploySteps.PostDeploy;
            return execAsync(`grep -rli --exclude-dir=node_modules '${configuration.commitTag}' ${configuration.deployPath} | xargs sed -i '' 's/${configuration.commitTag}/${branch.commit}/'`);
        })
        .then((markCommitResult: any) => {
            console.log('[deploy] Including commit done');
            console.log('[deploy] MarkCommitResult:', markCommitResult);
        })
        .then(() => {
            // restart servers
            if (!configuration.restartScript) return;

            currentStep = DeploySteps.Restart;
            return execAsync(`${configuration.restartScript}`);
        })
        .then((restartResult: any) => {
            if (restartResult) {
                console.log('[deploy] Restarting done');
                console.log('[deploy] RestartResult:', restartResult);
            }
        })
        .then(() => {
            console.log('[deploy] Deployment success!');
            console.log('[deploy] BUILD/TEST SUCCESS!, commit: ' + branch.label + ', ' + branch.commit);
            const text = configuration.successText + '\ncommit:' + branch.label + ', ' + branch.commit;
            const msg = {...formatProgress(text, deploySteps, currentStep), channel: configuration.slackChannel, username: configuration.slackUser, icon_emoji: ':simple_smile:' };

            if (!configuration.isDebug && configuration.successText) {
                return notifySlack(configuration.slackPath, JSON.stringify(msg));
            }
            else {
                console.log('[deploy] Slack message:', JSON.stringify(msg, null, 2));
            }
        })
        .catch((error) => {
            console.error(`[deploy] BUILD/TEST ERROR, commit: ${branch.commit}`, error);
            console.error(`[deploy] ERROR Log: ${error.stderr || error}`);
            let aggregateErrors = '' + error.aggregateErrors;
            if (aggregateErrors.length > 500) aggregateErrors = aggregateErrors.substr(-500);

            let errorLocal = '' + error.error;
            if (errorLocal.length > 1000) errorLocal = errorLocal.substr(-1000);

            const text = configuration.failedText + '\ncommit:' + branch.label + ', ' + branch.commit;
            const msg = {...formatProgress(text, deploySteps, currentStep, error), channel: configuration.slackChannel, username: configuration.slackUser, icon_emoji: ':monkey_face:' };
            if (!configuration.isDebug) {
                return notifySlack(configuration.slackPath, JSON.stringify(msg));
            }
            else {
                console.log('[deploy] Slack message:', JSON.stringify(msg, null, 2));
            }
        })
        .finally(() => {
            processing$.next(false);
        });
}

function formatAggregateErrors(errors: any) {
    const indicator = (result) => result.error ? ':small_red_triangle_down:' : (result.done ? ':black_small_square:' : ':white_small_square:');
    return Object.keys(errors).map(task => {
        const result = errors[task];
        return indicator(result) + ` ${task}` + (result.error ? `\n${formatError(result.error)}` : '');
    }).join('\n');
}

function formatError(error) {
    if (error.error && error.error.cmd) {
        return `\`[${error.error.code}] ${error.error.cmd}\`\n>\`\`\`aggregateErrors:\n${error.aggregateErrors}\`\`\`\n\`\`\`STDERR:\n${error.stderr}\`\`\``;
    }
    if (error.sterr) {
        return `\`\`\`aggregateErrors:\n${error.aggregateErrors}\`\`\`\n\`\`\`STDERR:\n${error.stderr}\`\`\``;
    }
    if (error.aggregateErrors) {
        return formatAggregateErrors(error.aggregateErrors);
    }
    return `UNEXPECTED ERROR:\n\`\`\`${error}\`\`\``
}

function formatProgress(text: string, steps: DeploySteps[], currentStep: DeploySteps, error: any = null) {
    let hasFailed = false;
    const progress = steps.map(step => {
        hasFailed = hasFailed || (step === currentStep && error);
        const stepName = DeploySteps[step];
        if (step === currentStep && error) {
            hasFailed = true;
            return `:x: ${stepName}`;
        }
        return hasFailed ? `:double_vertical_bar: ${stepName}` : `:white_check_mark: ${stepName}`;
    });
    let attachments: any[];
    if (error) {
        return {
            'attachments': [
                {
                    'pretext': text,
                    'color': error ? 'danger' : 'good',
                    'title': 'ZEM Sandbox Deployement',
                    'text': progress.join('\n'),
                },
                {
                    'color': 'warning',
                    'mrkdwn_in': ['text'],
                    'text': formatError(error),
                    'title': 'Error details'
                }
            ]
        };
    }
    return {
        'text': text,
    }
}
