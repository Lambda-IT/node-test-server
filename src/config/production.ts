export const config = {
    path: '/var/zem/build',
    buildPath: '/var/zem/build/',
    deployPath: '/var/www/zem/',
    slackUser: 'zem-build [production]',
    failedText: 'ZEM production build FAILED!',
    successText: 'ZEM production build SUCCESS!',
    branch: 'production',
    isDebug: false,
    buildScript: {
        'npm install': ['cd Backend && npm install --no-save --no-progress', 'cd Frontend && npm install --no-save --no-progress'],
        'build': ['cd Backend && npm run build', 'cd Frontend && npm run build-fp-prod', 'cd Frontend && npm run build-mv-prod'],
    },
    testScript: {
        'Unit Tests': ['cd Backend && npm run test-on-prod 2> /dev/null | egrep "^([#]|not)"', 'cd Frontend && npm run test-once-compact']
    },
    restartScript: 'pm2 restart all --update-env'
};
