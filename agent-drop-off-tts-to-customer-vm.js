'use strict'

//-------------

require('dotenv').config();

//--
const express = require('express');
const bodyParser = require('body-parser')
const app = express();
require('express-ws')(app);

const webSocket = require('ws');

app.use(bodyParser.json());

//---- CORS policy - Update this section as needed ----

app.use(function (req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  res.header("Access-Control-Allow-Methods", "OPTIONS,GET,POST,PUT,DELETE");
  res.header("Access-Control-Allow-Headers", "Content-Type, Access-Control-Allow-Headers, Authorization, X-Requested-With");
  next();
});

//-------

const servicePhoneNumber = process.env.SERVICE_PHONE_NUMBER;
console.log("Service phone number:", servicePhoneNumber);

//--- Vonage API ---

const { Auth } = require('@vonage/auth');

const credentials = new Auth({
  apiKey: process.env.API_KEY,
  apiSecret: process.env.API_SECRET,
  applicationId: process.env.APP_ID,
  privateKey: './.private.key'    // private key file name with a leading dot 
});

const apiBaseUrl = "https://" + process.env.API_REGION;

const options = {
  apiHost: apiBaseUrl
};

const { Vonage } = require('@vonage/server-sdk');

const vonage = new Vonage(credentials, options);

//--- Connector server (middleware) ---
const processorServer = process.env.PROCESSOR_SERVER;

//---- Custom settings ---
const maxCallDuration = process.env.MAX_CALL_DURATION; // in seconds

//============= Initiating outbound PSTN calls ===============

//-- Manually trigger outbound PSTN call to "callee1" number then to "calle2" number --
//-- see sample request below --
//-- sample request: https://<server-address>/call?callee1=12995550101&callee2=129995550202 --

app.get('/call', async(req, res) => {

  if (req.query.callee1 == null || req.query.callee2 == null) {

    res.status(200).send('"callee1" or "callee2" number missing as query parameter - please check');
  
  } else {

    // code may be added here to make sure the numbers are in valid E.164 format (without leading '+' sign)
  
    res.status(200).send('Ok');  

    const hostName = req.hostname;
    const callee2 = req.query.callee2;

    //-- Outgoing PSTN call --

    vonage.voice.createOutboundCall({
      to: [{
        type: 'phone',
        number: req.query.callee1
      }],
      from: {
       type: 'phone',
       number: servicePhoneNumber
      },
      length_timer: maxCallDuration, // limit outbound call duration if desired
      answer_url: ['https://' + hostName + '/answer_1' + '?callee2=' + callee2],
      answer_method: 'GET',
      event_url: ['https://' + hostName + '/event_1' + '?callee2=' + callee2],
      event_method: 'POST'
      })
      .then(res => console.log(">>> Outgoing PSTN call status:", res))
      .catch(err => console.error(">>> Outgoing PSTN call error:", err))

    }

});

//-----------------------------

app.get('/answer_1', async(req, res) => {

  const hostName = req.hostname;
  const uuid = req.query.uuid;
  const callee2 = req.query.callee2;

  const nccoResponse = [
    {
      "action": "talk",
      "text": "Hello. This is a call from your preferred provider, please wait.",
      "language": "en-US",
      "style": 11
    },
    {
      "action": "connect",
      "eventUrl": ["https://" + hostName + "/event_connect_1"],
      "from": servicePhoneNumber,
      "endpoint": [
        {
          "type": "phone",
          "number": callee2
        }
      ]
    }

  ];

  res.status(200).json(nccoResponse);

 });

//------------

app.post('/event_1', async(req, res) => {

  res.status(200).send('Ok');

});

//------------

app.post('/event_connect_1', async(req, res) => {

  res.status(200).send('Ok');

});

//--------------------

app.post('/ws_event', async(req, res) => {

  res.status(200).send('Ok');

});

//------------

app.get('/transfer', async(req, res) => {  // request via a web browser

  //-- Trigger connecttion of user call leg with WebSocket --
  //-- trigger from a web browser --
  //-- sample request: https://<server-address>/transfer?uuid_to_transfer=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx --

  res.status(200).send('Ok');

  const hostName = req.hostname;

  const uuidToTransfer = req.query.uuid_to_transfer;

  let connectorHost;

  if (processorServer == undefined) {
    connectorHost = hostName;
  } else {
    connectorHost = processorServer;
  }

  const wsUri = 'wss://' + connectorHost + '/socket?peer_uuid=' + uuidToTransfer + '&webhook_url=https://' + hostName + '/results'

  const ncco = [
    {
      "action": "connect",
      "eventUrl": ["https://" + hostName + "/ws_event"],
      "from": "12995550101",    // not important
      "endpoint": [
        {
          "type": "websocket",
          "uri": wsUri,
          "content-type": "audio/l16;rate=16000", // never modify
          "headers": {}
        }
      ]
    }
  ];   

  vonage.voice.transferCallWithNCCO(uuidToTransfer, ncco)
  .then(res => console.log(">>> Connecting WebSocket with remote party"))
  .catch(err => console.error(">>> WebSocket error:", err))

});

//------------

app.post('/transfer', async(req, res) => { // request button in a GUI

  //-- set the value of uuid_to_transfer in the HTTP POST request body --

  res.status(200).send('Ok');

  const hostName = req.hostname;

  const uuidToTransfer = req.body.uuid_to_transfer;

  let connectorHost;

  if (processorServer == undefined) {
    connectorHost = hostName;
  } else {
    connectorHost = processorServer;
  }

  const wsUri = 'wss://' + processorServer + '/socket?peer_uuid=' + uuidToTransfer + '&webhook_url=https://' + hostName + '/results'

  const ncco = [
    {
      "action": "connect",
      "eventType": "synchronous",
      "eventUrl": ["https://" + connectorHost + "/ws_event"],
      "from": "12995550101",    // not important
      "endpoint": [
        {
          "type": "websocket",
          "uri": wsUri,
          "content-type": "audio/l16;rate=16000", // never modify
          "headers": {}
        }
      ]
    }
  ];   

  vonage.voice.transferCallWithNCCO(uuidToTransfer, ncco)
  .then(res => console.log(">>> Connecting WebSocket with remote party"))
  .catch(err => console.error(">>> WebSocket error:", err))

});

//------------

app.post('/results', async(req, res) => {

  console.log(req.body)

  res.status(200).send('Ok');

});

//=================== Connector server =========================
//--- Handling WebSockets from Vonage Voice API platform

//-- In this sample code, it does nothing else besides accepting the WebSocket connection

app.ws('/socket', async (ws, req) => {

  ws.on('message', async (msg) => {
    
    if (typeof msg === "string") {
    
      console.log("\n>>> Vonage WebSocket text message:", msg);
    
    }

  });

  //--

  ws.on('close', async () => {
    
    console.log("Vonage WebSocket closed");

  });

});

//================ For Vonage Cloud Runtime (VCR) only ==============
//--- If this application is hosted on VCR  --------

app.get('/_/health', async(req, res) => {

  res.status(200).send('Ok');

});

//=====================================================================

const port = process.env.VCR_PORT || process.env.PORT || 8000;

app.listen(port, () => console.log(`Voice API application and Connector application listening on local port ${port}.`));

//------------