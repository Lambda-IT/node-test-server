export const config = {
    path: '/var/zem/build',
    buildPath: '/var/zem/build/',
    deployPath: '/var/www/zem/',
    branch: 'master',
    isDebug: false,
    buildScript: 'cd zemshared && npm install > dev null && ' +
                 'cd ../Backend && npm uninstall zemshared > /dev/null && npm install > /dev/null && npm run build && ' +
                 'cd ../Frontend/zemfrontendshared && npm install > /dev/null && ' +
                 'cd ../fotoportal && npm install > /dev/null &&  npm run reinstallshared > /dev/null && ng build --environment=sandbox 2> /dev/null && ' +
                 'cd ../medienverwaltung && npm install > /dev/null && npm install zemfrontendshared > /dev/null && npm run build 2> /dev/null',
    restartScript: 'pm2 restart zem-web-api --update-env && pm2 restart zem-identity-server --update-env'
};
