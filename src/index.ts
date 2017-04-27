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

function promiseFromChildProcess(child) {
    return new Promise(function (resolve, reject) {
        child.addListener('error', reject);
        child.addListener('exit', resolve);
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
                    result.data = [];

                    const gitWrapper = new GitWrapper(simpleGit(configuration.path));
                    return gitWrapper.getCurrentBranch()
                })
                .then(branch => {
                    result.branch = branch;
                    console.log('Branch', branch);

                    const childBuild = exec(`cd ${configuration.buildPath} && ${configuration.buildScript}`);
                    childBuild.stdout.on('data', (data) => {
                        console.log(data);
                        result.data.push('' + data);
                    });
                    return promiseFromChildProcess(childBuild);
                })
                .then(() => {
                    console.log('build done');
                    console.log(_.takeRight(result.data, 5).join('\n'));
                })
                .then(() => {
                    const childTest = exec(`cd ${configuration.buildPath} && ${configuration.testScript}`);
                    childTest.stdout.on('data', (data) => {
                        result.data.push('' + data);
                    });

                    return promiseFromChildProcess(childTest);
                })
                .then(() => {
                    console.log('testing done');
                    console.log('log tail: ');
                    console.log(_.takeRight(result.data, 5).join('\n'));

                    if (_.last(result.data).indexOf('fail') !== -1)
                        throw new Error('Tests faild: ' + _.last(result.data));
                })
                .then(() => {
                    // deploy
                    return fs.copyAsync(configuration.path, configuration.deployPath, { filter: deployFilterFunc, overwrite: true })
                        .then(() => {
                            console.log('deployment copy success!')
                        });
                })
                .then(() => {
                    const childDeploy = exec(`cd ${configuration.deployPath} && ${configuration.buildScript}`);
                    childDeploy.stdout.on('data', (data) => {
                        result.data.push('' + data);
                    });
                    return promiseFromChildProcess(childDeploy);
                })
                .then(() => {
                    console.log('deployScript done');
                    console.log(_.takeRight(result.data, 5).join('\n'));
                })
                .then(() => {
                    // restart servers
                    if (!configuration.restartScript) return;

                    const childRestart = exec(`${configuration.restartScript}`);
                    childRestart.stdout.on('data', (data) => {
                        result.data.push('' + data);
                    });

                    return promiseFromChildProcess(childRestart);
                })
                .then(() => {
                    console.log('restartScript done');
                    console.log(_.takeRight(result.data, 5).join('\n'));
                })
                .then(() => {
                    console.log('deployment success!');
                    console.log('BUILD/TEST SUCCESS!, commit: ' + result.branch.label + ', ' + result.branch.commit);
                })
                .catch((error) => {
                    console.log(_.takeRight(result.data, 10).join('\n'));
                    console.error(`BUILD/TEST ERROR: ${error}, commit: ${result.branch.commit}`);
                    const msg = { text: configuration.failedText + '\ncommit:' +  result.branch.label + ', ' + result.branch.commit + '\n' + _.takeRight(result.data, 5).join('\n'), channel: configuration.slackChannel, link_names: 1, username: configuration.slackUser, icon_emoji: ':monkey_face:' };
                    if (!configuration.isDebug)
                        return notifySlack(configuration.slackPath, JSON.stringify(msg));
                })
                .finally(() => {
                    processing$.next(false);
                });
        }
    }
});
