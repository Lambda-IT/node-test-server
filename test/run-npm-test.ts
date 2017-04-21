import { exec } from 'child_process';
import * as assert from 'assert';

const path = 'd:/projects/build-test/'

describe('runs npm tests', function () {
    it('it should return success', (done) => {
        const test = exec(`cd ${path} && npm install && npm test`, (error, stdout, stderr) => {
            if (error) {
                console.error(`exec error: ${error}`);
                return done(error);
            }
            console.log(`stdout: ${stdout}`);
            console.log(`stderr: ${stderr}`);
            assert.ok('success');
            done();
        });
    });
});