const chalk = require('chalk');
const Client = require('ssh2').Client;
const fs = require('fs');
const glob = require('glob');
const inquirer = require('inquirer');
const ora = require('ora');

class Run {
	constructor (config, program) {
		this.config = config;
		this.program = program;

		this.server = null;
		this.sshPassword = null;

		this.debug(`Executing 'run' command...`);

		this.askForPassword()
			.then(() => this.connectToServer())
			.then(() => this.getSources())
			.catch((err) => {
				console.error(chalk.red(err.message));
				if (this.server) this.server.end();
			});
	}

	debug (msg) {
		if (this.program.verbose) console.debug(chalk.gray(msg));
	}

	// Ask the user for a password
	askForPassword () {
		return inquirer.prompt([{
			message: 'What is your SSH private key passphrase?',
			name: 'password',
			type: 'password',
		}]).then((result) => {
			this.sshPassword = result.password;
			return this.sshPassword;
		}).catch((err) => {
			console.log(err);

			// ssh2 reports wrong password as "InvalidAsn1Error", with no
			// way to catch it in `connectToServer`
			if (err && err.name === 'InvalidAsn1Error') {
				throw new Error(`Wrong password. Try again.`);
			}

			throw err;
		});
	}

	// Connect to deployment server
	connectToServer () {
		const {host, private_key_path, user} = this.config;

		const spinner = this.program.verbose ?
			ora(`Connecting to ${chalk.yellow(host)}...`) :
			null;

		return new Promise((resolve, reject) => {
			let privateKey;
			try {
				privateKey = fs.readFileSync(private_key_path);
			} catch (err) {
				throw new Error(
					`Can't find private SSH key in ${chalk.yellow(private_key_path)}. ` +
					`Make sure you're running this script via Bash.`
				);
			}

			const c = new Client();
			c.on('ready', () => {
				spinner.succeed(`Connected to ${chalk.yellow(host)}`);
				resolve(c);
			}).connect({
				host,
				username: user,
				privateKey,
				passphrase: this.sshPassword,
			});
		});
	}

	// Finds a list of directories and files that will be uploaded
	getSources () {
		const spinner = this.program.verbose ?
			ora('Compiling a list of source files...') :
			null;

		return Promise.all(
			this.config.sources.map((sourceGlob) => {
				return new Promise((resolve, reject) => {
					glob(sourceGlob, {realpath: true}, (err, files) => {
						if (err) {
							this.debug(`Source scan failed: ${err}`);
							return reject(err);
						}
						return resolve(files);
					});
				});
			})
		).then((responses) => {
			const sources = responses.reduce((items, result) => (
				result.concat(items)
			), []);

			spinner.succeed(`Found ${sources.length} source items.`);

			return sources;
		}).catch((err) => {
			spinner.fail(`Source scan failed: ${err.message}`);
		});
	}
}

module.exports = Run;
