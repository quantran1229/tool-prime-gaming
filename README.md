# TOOL-PRIME-GAMING

This tool will read from a sheet file, get user's email + password. Login. Active Prime Game(if needed). Get code(if needed) and update back to sheet. This can be run in headless or browser. Make sure when running code => no using copy as this code use clipboard and it could conflict!


First follow this to create `google_cred.json` file https://theoephraim.github.io/node-google-spreadsheet/#/getting-started/authentication with Service Account.


Create .env file.


Start running
```
npm start
```

```
=> Email abcxyz@email.com
Signing in...
Sign in success!
Try to activate
Not activate prime! Activating!
Activated!
Try to get game content!
Your gift is collected! Here is the code abcdefgh
DONE! Time: 22399 ms; Avg: 13.077179487179487 s/user. Total user 78
```