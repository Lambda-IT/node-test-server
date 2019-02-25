import * as _ from 'lodash';

const config = {
    slackPath: '/services/T02JX7JE0/B52QJB797/X2cagdUz58OPML6OzjfaUUfJ',
    slackChannel: '#zem-development',
    slackUser: 'zem-build',
    failedText: 'ZEM build failed!',
    successText: 'ZEM build SUCCESS!',
    poll: 60,
    remote: 'origin',
    branch: 'master',
    strict: false,
    path: 'd:/projects/build-test',
    buildPath: 'd:/projects/build-test',
    buildScript: {
        'npm install': ['cd Backend && npm install --no-save --no-progress', 'cd Frontend && npm install --no-save --no-progress'],
        'build': ['cd Backend && npm run build', 'cd Frontend && npm run build-fp-sandbox', 'cd Frontend && npm run build-mv-sandbox'],
    },
    testScript: {
        'Unit Tests': ['cd Backend && npm test', 'cd Frontend && npm run test-once-compact']
    },
    postTasks: {
        'e22': ['cd Frontend && npm run e2e']
    },
    deployPath: 'd:/projects/deploy-test',
    environmentVariables: {},
    // restartScript: 'pm2 zem-web-api restart'
    commitTag : '%%COMMIT%%'
}

export const configuration = {...config, ...(require(`./${process.env.NODE_ENV || 'development'}`).config || {})};
