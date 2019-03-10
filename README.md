# Poll bot

This bot can be used to ask feedback from users to vote on different questions, which have pre-defined options given for user to choose. Everybody can ask a question on Obyte platfrom using a single-address wallet and posting a poll on Send screen in wallet, but person who runs the bot (using `arrPolls` configuration variable) or website like [Obyte.io](https://obyte.io/polls) can decided, which polls are shown to users.

Each vote will be signed with all the funded addresses in currently selected wallet, each vote costs a fee, which mostly depends on how many funded addresses currently selected wallet has (single-address wallets have smaller fees). By default, the bot will show results by all unspent balances of addresses that user used for voting, but results can also shown also by real name attested users, email attested users or steem attested users in which case each attested user's last vote will be only counted once.

## Accessing polls and results from websites
This bot accepts commands outside of the wallet, which can be sent using [`byteball:` protocol URI](https://developer.obyte.org/byteball-protocol-uri#sending-commands-to-chat-bots) as pairing secret code. These are commands that can be used:
* `polls` ~ shows all whitelisted polls;
* `poll-POLL_UNIT_ID` ~ shows options of this specific poll;
* `stats-POLL_UNIT_ID` ~ shows results by balances of this specific poll;
* `attested-POLL_UNIT_ID` ~ shows results by real name attested users of this specific poll;
* `email-POLL_UNIT_ID` ~ shows results by email attested users of this specific poll;
* `steem-POLL_UNIT_ID` ~ shows results by Steem attested users of this specific poll;

Using `byteball:` protocol URI, a HTML hyperlink like this could be created using `byteball:BOT_PAIRING_CODE#COMMAND_AS_PARING_SECRET` pattern as `href` attribute.
```
<a href="byteball:AhMVGrYMCoeOHUaR9v/CZzTC34kScUeA4OBkRCxnWQM+@byteball.org/bb#poll-pecgjVXpD+UaVA1Tf0WBtdleC4vtWh/EtaghX/u/vEU=">
	vote on this poll
</a>
```

Same commands (without pairing code) work also in bot, but when any command with `POLL_UNIT_ID` was used, following commands can be used as well because the bot will remember, which poll user interacted with previously:
* `poll` ~ shows options of previously interacted poll;
* `stats` ~ shows results by balances of previously interacted poll;
* `attested` ~ shows results by real name attested users of previously interacted poll;
* `email` ~ shows results by email attested users of previously interacted poll;
* `steem` ~ shows results by Steem attested users of previously interacted poll;

Misunderstood or command `polls` will reset previously used `POLL_UNIT_ID`.