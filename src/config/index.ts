import * as _ from 'lodash';

const config = {
    slackPath: '/services/T02JX7JE0/B52QJB797/X2cagdUz58OPML6OzjfaUUfJ',
    slackChannel: '#zem',
    slackUser: 'zem-build',
    failedText: 'ZEM build failed!',
    poll: 60,
    remote: 'origin',
    branch: 'master',
    strict: false,
    path: 'd:/projects/build-test',
    buildPath: 'd:/projects/build-test',
    buildScript: 'npm install && npm build',
    testScript: 'npm test',
    deployPath: 'd:/projects/deploy-test',
    // restartScript: 'pm2 restart'
}

export const configuration = _.merge(config, require(`./${process.env.NODE_ENV || 'development'}`).config || {});
