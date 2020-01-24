/*jslint node: true */
'use strict';
const async = require('async');
const conf = require('ocore/conf.js');
const db = require('ocore/db.js');
const eventBus = require('ocore/event_bus.js');
const headlessWallet = require('headless-obyte');
const validationUtils = require('ocore/validation_utils.js');
const wallet = require('ocore/wallet.js');

var assocPollByDeviceAddress = {};

headlessWallet.setupChatEventHandlers();

function readListOfPolls(handleList){
	// get whitelisted polls
	db.query("SELECT unit, question FROM polls WHERE unit IN(?) ORDER BY rowid DESC;", [conf.arrPolls], rows => {
		let polls = rows.map(row => {
			return {unit: row.unit, question: row.question};
		});
		handleList(polls);
	});
}

function getListOfPollCommands(arrPolls){
	return arrPolls.map(poll => {
		let i = poll.question.indexOf(')');
		// use unit as a command if question contains closing parenthesis
		let command = (i === -1) ? poll.question : 'poll-'+ poll.unit;
		return '- ['+poll.question+'](command:'+command+')';
	});
}

function getListOfChoiceButtons(poll_unit, arrChoices){
	return arrChoices.map(choice => {
		let objVote = {
			poll_unit: poll_unit,
			choice: choice
		};
		let voteJsonBase64 = Buffer(JSON.stringify(objVote)).toString('base64');
		return '- ['+choice+'](vote:'+voteJsonBase64+')';
	});
}

function sendListOfPolls(device_address){
	let device = require('ocore/device.js');

	// forget previously selected poll
	if (assocPollByDeviceAddress[device_address]){
		delete assocPollByDeviceAddress[device_address];
	}

	readListOfPolls(arrPolls => {
		let arrCommands = getListOfPollCommands(arrPolls);
		device.sendMessageToDevice(device_address, 'text', 'Please select the poll you would like to vote on:\n\n'+arrCommands.join('\n'));
	});
}


function readQuestion(poll_unit, handleQuestion){
	db.query("SELECT question FROM polls WHERE unit=?;", [poll_unit], rows => {
		if (rows.length === 0){
			return handleQuestion();
		}
		handleQuestion(rows[0].question);
	});
}


function calcResults(poll_unit, command, handleResults){
	var attestators = [];
	switch (command) {
		case 'steem':
			attestators = conf.arrSteemAttestors;
			break;
		case 'email':
			attestators = conf.arrEmailAttestors;
			break;
		default:
			attestators = conf.arrRealNameAttestors;
			break;
	}
	db.query("SELECT attested_fields.value, choice FROM votes JOIN unit_authors USING(unit) JOIN attested_fields USING(address) WHERE attestor_address IN(?) AND `field`='user_id' AND poll_unit=? ORDER BY votes.rowid;", [attestators, poll_unit], rows => {
		var assocChoiceByAttestedUser = {};
		rows.forEach(row => {
			assocChoiceByAttestedUser[row.value] = row.choice; // later vote overrides the earlier one
		});
		var assocAttestedUserByChoice = {};
		for (var attestedUser in assocChoiceByAttestedUser){
			var choice = assocChoiceByAttestedUser[attestedUser];
			if (!assocAttestedUserByChoice[choice]){
				assocAttestedUserByChoice[choice] = [];
			}
			assocAttestedUserByChoice[choice].push(attestedUser);
		}
		var assocUsersBySortedChoice = {};
		db.query("SELECT choice FROM poll_choices WHERE unit=? ORDER BY choice_index;", [poll_unit], rows => {
			rows.forEach(row => {
				// set stats for that choice to zero if nobody has voted for that choice
				if (!assocAttestedUserByChoice[row.choice]){
					assocUsersBySortedChoice[row.choice] = [];
				}
				else {
					assocUsersBySortedChoice[row.choice] = assocAttestedUserByChoice[row.choice];
				}
			});
			handleResults({users: assocUsersBySortedChoice, attestedTotal: Object.keys(assocChoiceByAttestedUser).length});
		});
	});
}

function calcStatsByBalance(poll_unit, handleStats){
	db.query("SELECT address, choice FROM votes JOIN unit_authors USING(unit) WHERE poll_unit=? ORDER BY votes.rowid;", [poll_unit], rows => {
		var assocChoiceByAddress = {};
		rows.forEach(row => {
			assocChoiceByAddress[row.address] = row.choice; // later vote overrides the earlier one
		});
		var assocAddressesByChoice = {};
		for (var address in assocChoiceByAddress){
			var choice = assocChoiceByAddress[address];
			if (!assocAddressesByChoice[choice]){
				assocAddressesByChoice[choice] = [];
			}
			assocAddressesByChoice[choice].push(address);
		}
		var assocTotals = {};
		var assocBalanceBySortedChoice = {};
		async.forEachOf(
			assocAddressesByChoice,
			function(arrAddresses, choice, cb){
				db.query(
					"SELECT SUM(amount) AS total FROM outputs \n\
					WHERE asset IS NULL AND is_spent=0 AND address IN("+arrAddresses.map(address => db.escape(address)).join(', ')+");",
					rows => {
						assocTotals[choice] = rows[0].total;
						cb();
					}
				);
			},
			function(){
				// get all poll choices, so there would be stats to show even if nobody has voted for that choice
				db.query("SELECT choice FROM poll_choices WHERE unit=? ORDER BY choice_index;", [poll_unit], rows => {
					rows.forEach(row => {
						// set stats for that choice to zero if nobody has voted for that choice
						if (!assocAddressesByChoice[row.choice] || !assocTotals[row.choice]){
							assocAddressesByChoice[row.choice] = [];
							assocBalanceBySortedChoice[row.choice] = 0;
						}
						else {
							assocBalanceBySortedChoice[row.choice] = assocTotals[row.choice];
						}
					});
					handleStats({totals: assocBalanceBySortedChoice, addresses: assocAddressesByChoice});
				});
			}
		);
	});
}

function sendResults(device_address, poll_unit, poll_question, command){
	let device = require('ocore/device.js');

	assocPollByDeviceAddress[device_address] = poll_unit;
	calcResults(poll_unit, command, resultsData => {
		var arrResults = [];
		for (var choice in resultsData.users){
			arrResults.push('- '+ choice + ': '+ resultsData.users[choice].length +' attested users' + (resultsData.attestedTotal ? ' ('+ Math.round(resultsData.users[choice].length/resultsData.attestedTotal*1000)/10 +'%)' : '') );
		}
		device.sendMessageToDevice(device_address, 'text', 'Results for:\n' + poll_question + '\n\n' + arrResults.join('\n') +'\n\nSee [results by balances](command:stats) or [approved polls](command:polls) or [vote again](command:poll) on this poll.');
	});
}

function sendStatsByBalance(device_address, poll_unit, poll_question){
	let device = require('ocore/device.js');

	assocPollByDeviceAddress[device_address] = poll_unit;
	calcStatsByBalance(poll_unit, statsData => {
		var arrStats = [];
		for (var choice in statsData.totals){
			arrStats.push('- '+ choice + ': '+(statsData.totals[choice]/1e9)+' GB ('+ statsData.addresses[choice].length +' addresses)');
		}
		device.sendMessageToDevice(device_address, 'text', 'Stats for:\n' + poll_question + '\n\n' + arrStats.join('\n') +'\n\nSee [results by attested users](command:attested) or [approved polls](command:polls) or [vote again](command:poll) on this poll.');
	});
}

function sendPoll(device_address, poll_unit, poll_question){
	let device = require('ocore/device.js');

	assocPollByDeviceAddress[device_address] = poll_unit;
	db.query("SELECT choice FROM poll_choices WHERE unit=? ORDER BY choice_index;", [poll_unit], rows => {
		if (rows.length === 0){
			return device.sendMessageToDevice(device_address, 'text', "no choices in poll "+poll_unit);
		}
		let arrChoices = rows.map(row => row.choice);
		device.sendMessageToDevice(device_address, 'text', 'Choose your answer for:\n'+ poll_question +'\n\n'+getListOfChoiceButtons(poll_unit, arrChoices).join('\n') +'\n\nSee [results by attested users](command:attested), [results by balances](command:stats) or [approved polls](command:polls).');
	});
}

function parseText(from_address, text){
	if (text.length > 10000){ // DoS
		return;
	}

	// pairing from Bot Store or polls reply in chat
	if (text === '*' || text === '0000' || text === 'polls'){
		return sendListOfPolls(from_address);
	}

	// `command` or `command-UNIT_ID` or `voted:SOME TEXT`, but not `command some text`
	let match_commands = text.match(/^(poll|stats|attested|email|steem|voted:)-?(\S.*)?$/i);
	if (match_commands){
		let poll_unit;
		// commands from `byteball:` URI
		if (match_commands.length === 3 && match_commands[2] && match_commands[1] !== 'voted:'){
			poll_unit = match_commands[2];
		}
		// commands when selected some poll or after voting on some poll
		else if (assocPollByDeviceAddress[from_address]){
			poll_unit = assocPollByDeviceAddress[from_address];
		}
		else {
			return sendListOfPolls(from_address);
		}
		readQuestion(poll_unit, poll_question => {
			if (!poll_question) return sendListOfPolls(from_address);

			if (match_commands[1] === 'voted:'){
				setTimeout(() => { // wait that the new vote is received
					sendStatsByBalance(from_address, poll_unit, poll_question);
				}, 2000);
			}
			if (match_commands[1] === 'poll'){
				sendPoll(from_address, poll_unit, poll_question);
			}
			else if (match_commands[1] === 'stats'){
				sendStatsByBalance(from_address, poll_unit, poll_question);
			}
			else {
				sendResults(from_address, poll_unit, poll_question, match_commands[1]);
			}
		});
		return;
	}

	// for displaying choices of whitelisted polls
	db.query("SELECT unit, question FROM polls WHERE unit IN(?) AND question LIKE ? LIMIT 1;", [conf.arrPolls, text.replace(/[%\?]/gi, '')+'%'], rows => {
		if (rows.length === 0){
			return sendListOfPolls(from_address);
		}
		return sendPoll(from_address, rows[0].unit, rows[0].question);
	});
}

eventBus.on('paired', parseText);

eventBus.on('text', parseText);

eventBus.on('headless_wallet_ready', () => {

});
