import { configuration } from './config';

import * as _ from 'lodash';
import { GitWatcher, RepoResult } from 'git-repo-watch';
import * as Rx from 'rxjs/Rx';
import { exec } from 'child_process';
import * as Promise from 'bluebird';
import * as fsExtra from 'fs-extra';

const fs: any = Promise.promisifyAll(fsExtra);

function promiseFromChildProcess(child) {
    return new Promise(function (resolve, reject) {
        child.addListener('error', reject);
        child.addListener('exit', resolve);
        child.stderr.on('data', reject);
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
    // will fire every check.
    console.log(`${configuration.path} checked`);
});

gw.result$.withLatestFrom(processing$).filter(x => !x[1]).subscribe(x => {
    // will fire once a check is finished.
    // When using Sync Fork the origin is now updated (and local ofcourse)

    const result: RepoResult & { data?: string[] } = x[0];

    if (result.error) {
        gw.unwatch(result.config);
        // don't forget to unsubscrive...
    } else {
        if (result.changed === true) {
            console.log(`start processing`, x);
            processing$.next(true);

            // new version, we can build it, publish to a site... whatever.
            console.log(`${result.config.path} changed`, result);
            result.data = [];

            const childBuild = exec(`cd ${result.config.path} && ${configuration.buildScript}`);
            childBuild.stdout.on('data', (data) => {
                console.log('testing: ', data);
                result.data.push('' + data);
            });

            return promiseFromChildProcess(childBuild)
                .then(() => {
                    console.log('build done');
                    console.log(_.takeRight(result.data, 5).join('\n'));
                    result.data = [];
                })
                .then(() => {
                    const childTest = exec(`cd ${configuration.deployPath} && ${configuration.testScript}`);
                    childTest.stdout.on('data', (data) => {
                        result.data.push('' + data);
                    });

                    return promiseFromChildProcess(childTest);
                })
                .then(() => {
                    console.log('testing done');
                    console.log('log tail: ');
                    console.log(_.takeRight(result.data, 5).join('\n'));
                    result.data = [];
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
                    result.data = [];
                })
                .then(() => {
                    // restart servers
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
                    console.log('success!');
                })
                .catch((error) => {
                    console.error(`test error: ${error}`);
                })
                .finally(() => {
                    processing$.next(false);
                });
        }
    }
});
