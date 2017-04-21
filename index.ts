import { GitWatcher, RepoResult } from 'git-repo-watch';

const gw = new GitWatcher();

// Use Sync Fork to check for changes in the upstream an update.
gw.watch({
    path: 'd:/projects/node-test-server',
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

            console.log('node-test-server changed', result.config);
        }
    }
});
