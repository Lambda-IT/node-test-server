import * as _ from 'lodash';

const config = {
    poll: 10,
    remote: 'origin',
    branch: 'master',
    strict: false,
    path: 'd:/projects/build-test',
    buildScript: 'npm install && tsc -p tsconfig.json',
    testScript: ' npm test',
    deployPath: 'd:/projects/deploy-test',
    restartScript: 'pm2 restart'
}

export const configuration = _.merge(config, require(`./${process.env.NODE_ENV || 'development'}`).config || {});