// server.js
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const cors = require('cors');
const { ClarifaiStub, grpc } = require('clarifai-nodejs-grpc');
const db = require('knex')({
  client: 'pg',
  connection: process.env.DATABASE_URL || {
    host: '127.0.0.1',
    port: 5433,
    user: 'postgres',
    password: process.env.DB_PASSWORD,
    database: 'smart-brain',
  },
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Clarifai gRPC setup
const PAT = process.env.CLARIFAI_PAT;
const USER_ID = process.env.CLARIFAI_USER_ID;
const APP_ID = process.env.CLARIFAI_APP_ID;
const MODEL_ID = 'face-detection';
const MODEL_VERSION_ID = '6dc7e46bc9124c5c8824be4822abe105';

const stub = ClarifaiStub.grpc();
const metadata = new grpc.Metadata();
metadata.set('authorization', 'Key ' + PAT);

// Face-detect endpoint
app.post('/api', (req, res) => {
  const { imageUrl } = req.body;
  if (!imageUrl) {
    return res.status(400).json({ error: 'imageUrl is required' });
  }

  const requestPayload = {
    user_app_id: { user_id: USER_ID, app_id: APP_ID },
    model_id: MODEL_ID,
    version_id: MODEL_VERSION_ID,
    inputs: [
      {
        data: {
          image: {
            url: imageUrl,
            allow_duplicate_url: true,
          },
        },
      },
    ],
  };

  stub.PostModelOutputs(requestPayload, metadata, (err, clarifaiResponse) => {
    if (err) {
      console.error('Clarifai gRPC error:', err);
      return res.status(500).json({ error: 'Face detection failed (gRPC error).' });
    }
    if (clarifaiResponse.status.code !== 10000) {
      console.error('Clarifai API error:', clarifaiResponse.status.description);
      return res
        .status(500)
        .json({ error: `Face detection failed (API status ${clarifaiResponse.status.code}).` });
    }

    const regions = clarifaiResponse.outputs[0].data.regions || [];
    const boxes = regions.map(r => r.region_info.bounding_box);
    res.json({ regions, boxes });
  });
});

// Signin
app.post('/signin', (req, res) => {
  const { email, passward } = req.body;
  db.select('hash').from('login').where({ email })
    .then(data => {
      if (data.length && bcrypt.compareSync(passward, data[0].hash)) {
        return db.select('*').from('users').where({ email })
          .then(user => res.json(user[0]));
      } else {
        res.status(400).json('unable to get user');
      }
    })
    .catch(() => res.status(400).json('wrong credentials'));
});

// Register
app.post('/register', (req, res) => {
  const { name, email, passward } = req.body;
  const hash = bcrypt.hashSync(passward, 10);
  db.transaction(trx => {
    return trx.insert({ hash, email })
      .into('login')
      .returning('email')
      .then(loginEmail => {
        return trx('users')
          .insert({ name, email: loginEmail[0], joined: new Date() })
          .returning('*')
          .then(user => res.json(user[0]));
      })
      .then(trx.commit)
      .catch(trx.rollback);
  })
    .catch(() => res.status(400).json('unable to register'));
});

// Profile
app.get('/profile/:id', (req, res) => {
  const { id } = req.params;
  db.select('*').from('users').where({ id })
    .then(user => {
      if (user.length) {
        res.json(user[0]);
      } else {
        res.status(400).json('not found');
      }
    })
    .catch(() => res.status(400).json('not found'));
});

// Image entries
app.put('/image', (req, res) => {
  const { id } = req.body;
  db('users').where({ id })
    .increment('entries', 1)
    .returning('entries')
    .then(entries => res.json(entries[0]))
    .catch(() => res.status(400).json('unable to get entries'));
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server is working on port ${PORT}`);
});
