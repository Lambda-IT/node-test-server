export const config = {
    path: '/var/zem/build',
    buildPath: '/var/zem/build/',
    deployPath: '/var/www/zem/',
    slackUser: 'zem-build [integration]',
    failedText: 'ZEM integration build FAILED!',
    successText: 'ZEM integration build SUCCESS!',
    branch: 'integration',
    isDebug: false,
    buildScript: {
        'npm install': ['cd Backend && npm install --no-save --no-progress', 'cd Frontend && npm install --no-save --no-progress'],
        'build': ['cd Backend && npm run build', 'cd Frontend && npm run build-fp-integration', 'cd Frontend && npm run build-mv-integration'],
    },
    testScript: {
        'Unit Tests': ['cd Backend && npm run test-on-int 2> /dev/null | egrep "^([#]|not)"', 'cd Frontend && npm run test-once-compact']
    },
    restartScript: 'pm2 restart all --update-env'
};
