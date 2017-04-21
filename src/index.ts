import { GitWatcher, RepoResult } from 'git-repo-watch';
import { exec } from 'child_process';
import * as Promise from 'bluebird';

function promiseFromChildProcess(child) {
    return new Promise(function (resolve, reject) {
        child.addListener('error', reject);
        child.addListener('exit', resolve);
    });
}

const gw = new GitWatcher();

// Use Sync Fork to check for changes in the upstream an update.
gw.watch({
    path: 'd:/projects/build-test',
    poll: 10,
    remote: 'origin',
    branch: 'master',
    strict: true
});

gw.check$.subscribe(info => {
    // will fire every check.
    console.log('node-test-server checked');
});

gw.result$.subscribe((result: RepoResult) => {
    // will fire once a check is finished.
    // When using Sync Fork the origin is now updated (and local ofcourse)

    if (result.error) {
        gw.unwatch(result.config);
        // don't forget to unsubscrive...
    } else {
        if (result.changed === true) {
            // new version, we can build it, publish to a site... whatever.
            console.log('node-test-server changed', result);

            const child = exec(`cd ${result.config.path} && npm install && tsc -p tsconfig.json && npm test`);
            child.stdout.on('data', function (data) {
                console.log('stdout: ' + data);
            });

            return promiseFromChildProcess(child)
                .then(() => {
                    console.log('testing done');
                })
                .catch((error) => {
                    console.error(`test error: ${error}`);
                });
        }
    }
});

// var spawn = child_process.spawn;
// var touch1 = spawn('npm', ['run', 'touch1', '--verbose'], { stdio: 'inherit' });
// touch1.on('error', function(err) {
//   console.error(err);
//   process.exit(1);
// });


// const process = spawn(...); // long running process
// // ... later...
// if (os.platform() === 'win32') { // process.platform was undefined for me, but this works
//     execSync(taskkill / F / T / PID ${process.pid }); // windows specific
// } else {
//     process.kill();
// }
