/*jslint node: true */
'use strict';
const async = require('async');
const conf = require('byteballcore/conf.js');
const db = require('byteballcore/db.js');
const eventBus = require('byteballcore/event_bus.js');
const headlessWallet = require('headless-byteball');
const validationUtils = require('byteballcore/validation_utils.js');
const wallet = require('byteballcore/wallet.js');

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

function getListOfPollCommands(arrQuestions){
	return arrQuestions.map(poll => {
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
	let device = require('byteballcore/device.js');

	// forget previously selected poll
	if (assocPollByDeviceAddress[device_address]){
		delete assocPollByDeviceAddress[device_address];
	}

	readListOfPolls(arrQuestions => {
		let arrCommands = getListOfPollCommands(arrQuestions);
		device.sendMessageToDevice(device_address, 'text', 'Please select the poll you would like to vote on:\n\n'+arrCommands.join('\n'));
	});
}


function readQuestion(poll_unit, handleQuestion){
	db.query("SELECT question FROM polls WHERE unit=?;", [poll_unit], rows => {
		if (rows.length === 0){
			throw Error("poll not found "+poll_unit);
		}
		handleQuestion(rows[0].question);
	});
}

function calcStats(poll_unit, handleStats){
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
							assocTotals[row.choice] = 0;
						}
					});
					handleStats({addresses: assocAddressesByChoice, totals: assocTotals});
				});
			}
		);
	});
}

function sendStats(device_address, poll_unit, poll_question){
	let device = require('byteballcore/device.js');

	calcStats(poll_unit, statsData => {
		var arrResults = [];
		for (var choice in statsData.totals){
			arrResults.push('- '+ choice + ': '+(statsData.totals[choice]/1e9)+' GB ('+ statsData.addresses[choice].length +' addresses)');
		}
		device.sendMessageToDevice(device_address, 'text', 'Stats for:\n' + poll_question + '\n\n' + arrResults.join('\n') +'\n\nSee other [polls](command:polls)');
	});
}

function sendPoll(device_address, poll_unit, poll_question){
	let device = require('byteballcore/device.js');

	assocPollByDeviceAddress[device_address] = poll_unit;
	db.query("SELECT choice FROM poll_choices WHERE unit=? ORDER BY choice_index;", [poll_unit], rows => {
		if (rows.length === 0){
			return device.sendMessageToDevice(device_address, 'text', "no choices in poll "+poll_unit);
		}
		let arrChoices = rows.map(row => row.choice);
		device.sendMessageToDevice(device_address, 'text', 'Choose your answer for:\n'+ poll_question +'\n\n'+getListOfChoiceButtons(poll_unit, arrChoices).join('\n') +'\n\nSee the [stats](command:stats) or other [polls](command:polls)');
	});
}

function parseText(from_address, text){
	if (text.length > 10000){ // DoS
		return;
	}

	// pairing from Bot Store or polls reply in chat
	if (text === '0000' || text === 'polls'){
		return sendListOfPolls(from_address);
	}

	// stats command when selected some poll or after voting on some poll
	if ((text === 'stats' || text.match(/^voted:/i)) && assocPollByDeviceAddress[from_address]){
		let poll_unit = assocPollByDeviceAddress[from_address];
		readQuestion(poll_unit, poll_question => {
			if (text === 'stats'){
				sendStats(from_address, poll_unit, poll_question);
			}
			else {
				setTimeout(() => { // wait that the new vote is received
					sendStats(from_address, poll_unit, poll_question);
				}, 2000);
			}
			return;
		});
		return;
	}

	// commands for byteball: URI
	if (text.match(/^poll-/i) || text.match(/^stats-/i)){
		db.query("SELECT unit, question FROM polls WHERE unit=?;", [text.replace('poll-', '').replace('stats-', '')], rows => {
			if (rows.length === 0){
				return sendListOfPolls(from_address);
			}
			if (text.match(/^stats-/i)){
				sendStats(from_address, rows[0].unit, rows[0].question);
			}
			else {
				sendPoll(from_address, rows[0].unit, rows[0].question);
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
