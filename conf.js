/*jslint node: true */
"use strict";

exports.port = null;
//exports.myUrl = 'wss://mydomain.com/bb';
exports.bServeAsHub = false;
exports.bLight = false;

exports.storage = 'sqlite';


exports.hub = 'byteball.org/bb';
exports.deviceName = 'Poll Bot';
exports.permanent_pairing_secret = '*'; // allow any pairing secret
exports.control_addresses = [];
exports.payout_address = 'WHERE THE MONEY CAN BE SENT TO';

exports.bIgnoreUnpairRequests = true;
exports.bSingleAddress = false;
exports.KEYS_FILENAME = 'keys.json';

exports.arrRealNameAttestors = ['I2ADHGP4HL6J37NQAD73J7E5SKFIXJOT', 'OHVQ2R5B6TUR5U7WJNYLP3FIOSR7VCED'];

// white list of poll units that we support
exports.arrPolls = ['pecgjVXpD+UaVA1Tf0WBtdleC4vtWh/EtaghX/u/vEU='];
