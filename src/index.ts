import { configuration } from './config';
import { notifySlack } from './http-service';

import * as _ from 'lodash';
import * as simpleGit from 'simple-git';
import { GitWatcher, RepoResult } from 'git-repo-watch';
import { GitWrapper } from 'git-repo-watch/GitWrapper';
import * as Rx from 'rxjs/Rx';
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
                        progress[task].done = true;
                        return result;
                    })
                    .catch(error => {
                        progress[task].error = error;
                        throw progress;
                    })
        })
        .then(results => results.reduce((acc, cur) => [...acc, ...cur], []))
        .catch((error) => {
            console.log('inner ERROR', error);
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
    console.log('copy ', src);
    return src.indexOf('node_modules') < 0 && src.indexOf('.git') < 0;
}

const gw = new GitWatcher();
const processing$: Rx.BehaviorSubject<boolean> = new Rx.BehaviorSubject(false);
processing$.asObservable().do(x => { console.log('processing changed', x); });

// Use Sync Fork to check for changes in the upstream an update.
gw.watch(configuration);

gw.result$
    .window(processing$.asObservable())
    .withLatestFrom(processing$)
    .flatMap(([c$, isBuilding]) => (isBuilding ? c$.takeLast(1) : c$))
    .subscribe(build);

gw.check$.subscribe(info => {
   console.log(`${new Date().toTimeString()} ${configuration.path} checked`);
});

function build(commit) {
    const deploy: RepoResult & { data?: string[], branch?: Branch } = commit;
    const deploySteps = [DeploySteps.Build, DeploySteps.Test, DeploySteps.Deploy, DeploySteps.PostDeploy, DeploySteps.Restart];
    let currentStep: DeploySteps = DeploySteps.Build;

    if (deploy.error) {
        console.error(`error processing`, deploy.error);
        gw.unwatch(deploy.config);
    } else {
        if (deploy.changed === true || configuration.isDebug) {
            console.log(`start processing`, commit);
            processing$.next(true);

            return Promise.resolve()
                .then(() => {
                    const gitWrapper = new GitWrapper(simpleGit(configuration.path));
                    return gitWrapper.getCurrentBranch()
                })
                .then(branch => {
                    deploy.branch = branch;
                    console.log('Branch', branch);
                    return execParallel(configuration.buildScript, configuration.buildPath);
                })
                .then((buildResult: any) => {
                    console.log('build done');
                    console.log('buildResult', buildResult);
                })
                .then(() => {
                    currentStep = DeploySteps.Test;
                    return execParallel(configuration.testScript, configuration.buildPath);
                })
                .then((testResult: any) => {
                    console.log('testing done');
                    console.log('testResult', testResult);
                })
                .then(() => {
                    currentStep = DeploySteps.Deploy;
                    return execAsync(`rsync -rtl ${configuration.buildPath} ${configuration.deployPath}`);
                })
                .then((deployResult: any) => {
                    console.log('deploying done');
                    console.log('deployResult', deployResult);
                })
                .then(() => {
                    currentStep = DeploySteps.PostDeploy;
                    return execAsync(`grep -rli --exclude-dir=node_modules '${configuration.commitTag}' ${configuration.deployPath} | xargs sed -i '' 's/${configuration.commitTag}/${deploy.branch.commit}/'`);
                })
                .then((markCommitResult: any) => {
                    console.log('including commit done');
                    console.log('markCommitResult', markCommitResult);
                })
                .then(() => {
                    // restart servers
                    if (!configuration.restartScript) return;

                    currentStep = DeploySteps.Restart;
                    return execAsync(`${configuration.restartScript}`);
                })
                .then((restartResult: any) => {
                    if (restartResult) {
                        console.log('restarting done');
                        console.log('restartResult', restartResult);
                    }
                })
                .then(() => {
                    console.log('deployment success!');
                    console.log('BUILD/TEST SUCCESS!, commit: ' + deploy.branch.label + ', ' + deploy.branch.commit);
                    const text = configuration.successText + '\ncommit:' + deploy.branch.label + ', ' + deploy.branch.commit;
                    const msg = {...formatProgress(text, deploySteps, currentStep), channel: configuration.slackChannel, username: configuration.slackUser, icon_emoji: ':simple_smile:' };

                    if (!configuration.isDebug && configuration.successText) {
                        return notifySlack(configuration.slackPath, JSON.stringify(msg));
                    }
                    else {
                        console.log('slack message:', JSON.stringify(msg, null, 2));
                    }
                })
                .catch((error) => {
                    console.error(`BUILD/TEST ERROR, commit: ${deploy.branch.commit}`, error);
                    // console.error(`Log: ${error.stdout}`);
                    console.error(`ERROR Log: ${error.stderr || error}`);
                    let stdout = '' + error.stdout;
                    if (stdout.length > 500) stdout = stdout.substr(-500);

                    let errorLocal = '' + error.error;
                    if (errorLocal.length > 1000) errorLocal = errorLocal.substr(-1000);

                    const text = configuration.failedText + '\ncommit:' + deploy.branch.label + ', ' + deploy.branch.commit;
                    const msg = {...formatProgress(text, deploySteps, currentStep, error), channel: configuration.slackChannel, username: configuration.slackUser, icon_emoji: ':monkey_face:' };
                    if (!configuration.isDebug) {
                        return notifySlack(configuration.slackPath, JSON.stringify(msg));
                    }
                    else {
                        console.log('slack message:', JSON.stringify(msg, null, 2));
                    }
                })
                .finally(() => {
                    processing$.next(false);
                });
        }
    }
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
        return `\`[${error.error.code}] ${error.error.cmd}\`\n>\`\`\`STDOUT:\n${error.stdout}\`\`\`\n\`\`\`STDERR:\n${error.stderr}\`\`\``;
    }
    if (error.sterr) {
        return `\`\`\`STDOUT:\n${error.stdout}\`\`\`\n\`\`\`STDERR:\n${error.stderr}\`\`\``;
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
