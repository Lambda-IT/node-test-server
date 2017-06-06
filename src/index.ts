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

function execAsync(args) {
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

        const cp = exec(args, callback);
    });
}

function deployFilterFunc(src, dest) {
    console.log('copy ', src);
    return src.indexOf('node_modules') < 0 && src.indexOf('.git') < 0;
}

const gw = new GitWatcher();
const processing$: Rx.BehaviorSubject<boolean> = new Rx.BehaviorSubject(false);
processing$.do(x => { console.log('processing changed', x); });

// Use Sync Fork to check for changes in the upstream an update.
gw.watch(configuration);

gw.check$.withLatestFrom(processing$).filter(x => !x[1]).subscribe(info => {
    console.log(`${new Date().toTimeString()} ${configuration.path} checked`);
});

gw.result$.withLatestFrom(processing$).filter(x => !x[1]).subscribe(x => {
    const result: RepoResult & { data?: string[], branch?: Branch } = x[0];

    if (result.error) {
        gw.unwatch(result.config);
    } else {
        if (result.changed === true || configuration.isDebug) {
            console.log(`start processing`, x);
            processing$.next(true);

            return Promise.resolve()
                .then(() => {
                    const gitWrapper = new GitWrapper(simpleGit(configuration.path));
                    return gitWrapper.getCurrentBranch()
                })
                .then(branch => {
                    result.branch = branch;
                    console.log('Branch', branch);
                    return execAsync(`cd ${configuration.buildPath} && ${configuration.buildScript}`);
                })
                .then((buildResult: any) => {
                    console.log('build done');
                    console.log('buildResult', buildResult.stdout);
                })
                .then(() => {
                    return execAsync(`cd ${configuration.buildPath} && ${configuration.testScript}`);
                })
                .then((testResult: any) => {
                    console.log('testing done');
                    console.log('testResult', testResult.stdout);
                })
                .then(() => {
                    return execAsync(`rsync -rtl ${configuration.buildPath} ${configuration.deployPath}`);
                })
                .then((deployResult: any) => {
                    console.log('deploying done');
                    console.log('deployResult', deployResult.stdout);
                })
                .then(() => {
                    return execAsync(`grep -rli --exclude-dir=node_modules '${configuration.commitTag}' ${configuration.deployPath} | xargs sed -i '' 's/${configuration.commitTag}/${result.branch.commit}/'`);
                })
                .then((markCommitResult: any) => {
                    console.log('including commit done');
                    console.log('markCommitResult', markCommitResult.stdout);
                })
                .then(() => {
                    // restart servers
                    if (!configuration.restartScript) return;

                    return execAsync(`${configuration.restartScript}`);
                })
                .then((restartResult: any) => {
                    if (restartResult) {
                        console.log('restarting done');
                        console.log('restartResult', restartResult.stdout);
                    }
                })
                .then(() => {
                    console.log('deployment success!');
                    console.log('BUILD/TEST SUCCESS!, commit: ' + result.branch.label + ', ' + result.branch.commit);
                    const msg = { text: configuration.successText + '\ncommit:' + result.branch.label + ', ' + result.branch.commit + '\n', channel: configuration.slackChannel, link_names: 1, username: configuration.slackUser, icon_emoji: ':simple_smile:' };

                    if (!configuration.isDebug && configuration.successText) {
                        return notifySlack(configuration.slackPath, JSON.stringify(msg));
                    }
                })
                .catch((error) => {
                    console.error(`BUILD/TEST ERROR, commit: ${result.branch.commit}`, error.error);
                    // console.error(`Log: ${error.stdout}`);
                    console.error(`ERROR Log: ${error.stderr || error}`);
                    let stdout = '' + error.stdout;
                    if (stdout.length > 500) stdout = stdout.substr(-500);

                    let errorLocal = '' + error.error;
                    if (errorLocal.length > 1000) errorLocal = errorLocal.substr(-1000);

                    const msg = { text: configuration.failedText + '\ncommit:' + result.branch.label + ', ' + result.branch.commit + '\n' + stdout + '\nERORR: ' + errorLocal, channel: configuration.slackChannel, link_names: 1, username: configuration.slackUser, icon_emoji: ':monkey_face:' };
                    if (!configuration.isDebug) {
                        return notifySlack(configuration.slackPath, JSON.stringify(msg));
                    }
                })
                .finally(() => {
                    processing$.next(false);
                });
        }
    }
});
