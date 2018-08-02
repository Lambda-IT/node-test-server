export const config = {
    path: '/var/zem/build',
    buildPath: '/var/zem/build/',
    deployPath: '/var/www/zem/',
    slackUser: 'zem-build [sandbox]',
    failedText: 'ZEM Sandbox build FAILED!',
    successText: 'ZEM Sandbox build SUCCESS!',
    branch: 'master',
    isDebug: false,
    buildScript: {
        'npm install': ['cd Backend && npm install --no-save --no-progress', 'cd Frontend && npm install --no-save --no-progress'],
        'build': ['cd Backend && npm run build', 'cd Frontend && npm run build-fp-sandbox', 'cd Frontend && npm run build-mv-sandbox'],
    },
    testScript: {
        'Unit Tests': ['cd Backend && npm run test-on-mac 2> /dev/null | egrep "^([#]|not)"', 'cd Frontend && npm run test-once-compact']
    },
    postTasks: {
        'e22': ['cd Frontend && npm run e2e-mv-sandbox']
    },
    restartScript: 'pm2 restart "zem-web-api (MV)" --update-env && pm2 restart "zem-web-api (FP)" --update-env'
};
