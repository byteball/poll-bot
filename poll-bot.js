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
	db.query("SELECT question FROM polls WHERE unit IN(?) ORDER BY rowid DESC", [conf.arrPolls], rows => {
		handleList(rows.map(row => row.question));
	});
}

function getListOfPollCommands(arrQuestions){
	return arrQuestions.map(question => {
		let i = question.indexOf(')');
		let command = (i === -1) ? question : question.substr(0, i);
		return '['+question+'](command:'+command+')';
	});
}

function getListOfChoiceButtons(poll_unit, arrChoices){
	return arrChoices.map(choice => {
		let objVote = {
			poll_unit: poll_unit,
			choice: choice
		};
		let voteJsonBase64 = Buffer(JSON.stringify(objVote)).toString('base64');
		return '['+choice+'](vote:'+voteJsonBase64+')';
	});
}

function sendListOfPolls(device_address){
	let device = require('byteballcore/device.js');
	readListOfPolls(arrQuestions => {
		let arrCommands = getListOfPollCommands(arrQuestions);
		device.sendMessageToDevice(device_address, 'text', 'Please select the poll you would like to vote on:\n\n'+arrCommands.join('\n'));
	});
}


function readQuestion(poll_unit, handleQuestion){
	db.query("SELECT question FROM polls WHERE unit=?", [poll_unit], rows => {
		if (rows.length === 0)
			throw Error("poll not found "+poll_unit);
		handleQuestion(rows[0].question);
	});
}

function calcStats(poll_unit, handleStats){
	db.query("SELECT address, choice FROM votes JOIN unit_authors USING(unit) WHERE poll_unit=? ORDER BY votes.rowid", [poll_unit], rows => {
		var assocChoiceByAddress = {};
		rows.forEach(row => {
			assocChoiceByAddress[row.address] = row.choice; // later vote overrides the earlier one
		});
		var assocAddressesByChoice = {};
		for (var address in assocChoiceByAddress){
			var choice = assocChoiceByAddress[address];
			if (!assocAddressesByChoice[choice])
				assocAddressesByChoice[choice] = [];
			assocAddressesByChoice[choice].push(address);
		}
		var assocTotals = {};
		async.forEachOf(
			assocAddressesByChoice,
			function(arrAddresses, choice, cb){
				db.query(
					"SELECT SUM(amount) AS total FROM outputs \n\
					WHERE asset IS NULL AND is_spent=0 AND address IN("+arrAddresses.map(address => db.escape(address)).join(', ')+")",
					rows => {
						assocTotals[choice] = rows[0].total;
						cb();
					}
				);
			},
			function(){
				handleStats(assocTotals);
			}
		);
	});
}

function sendStats(device_address, poll_unit){
	let device = require('byteballcore/device.js');
	calcStats(poll_unit, assocTotals => {
		var arrResults = [];
		for (var choice in assocTotals)
			arrResults.push(choice + ': '+(assocTotals[choice]/1e9)+' GB');
		readQuestion(poll_unit, question => {
			device.sendMessageToDevice(device_address, 'text', question + '\n\n' + arrResults.join('\n'));
		});
	});
}



eventBus.on('paired', sendListOfPolls);

eventBus.on('text', (from_address, text) => {
	let device = require('byteballcore/device.js');
	
	if (text.length > 10000) // DoS
		return;
	
	if ((text === 'stats' || text.match(/^voted:/i)) && assocPollByDeviceAddress[from_address]){
		let poll_unit = assocPollByDeviceAddress[from_address];
		if (text === 'stats')
			sendStats(from_address, poll_unit);
		else
			setTimeout(() => { // wait that the new vote is received
				sendStats(from_address, poll_unit);
			}, 2000);
		return;
	}
	
	db.query("SELECT unit FROM polls WHERE unit IN(?) AND question LIKE ?", [conf.arrPolls, text+'%'], rows => {
		if (rows.length > 1)
			return device.sendMessageToDevice(from_address, 'text', 'More than one poll with a question like this');
		if (rows.length === 0) // not like any existing poll
			return sendListOfPolls(from_address);
		let poll_unit = rows[0].unit;
		assocPollByDeviceAddress[from_address] = poll_unit;
		db.query("SELECT choice FROM poll_choices WHERE unit=? ORDER BY choice_index", [poll_unit], rows => {
			if (rows.length === 0)
				throw Error("no choices in poll "+poll_unit);
			let arrChoices = rows.map(row => row.choice);
			device.sendMessageToDevice(from_address, 'text', 'Choose your answer:\n'+getListOfChoiceButtons(poll_unit, arrChoices).join('\t')+'\n\nOr, see the [stats](command:stats)');
		});
	});
});


eventBus.on('headless_wallet_ready', () => {
});
