const express=require('express');
const app=express();
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const saltRounds = 10;
const cors = require('cors');
const fetch = require('node-fetch');
require('dotenv').config();
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

app.use(cors({origin: "*"}));
app.use(bodyParser.json());


app.post('/api', async (req, res) => {
  const { imageUrl } = req.body;
  
  // Validate environment variables
  const requiredEnvVars = ['CLARIFAI_USER_ID', 'CLARIFAI_APP_ID', 'CLARIFAI_PAT'];
  for (const envVar of requiredEnvVars) {
    if (!process.env[envVar]) {
      console.error(`Missing environment variable: ${envVar}`);
      return res.status(500).json({ error: `Server configuration error: ${envVar} not set` });
    }
  }
  
  try {
    const raw = JSON.stringify({
      user_app_id: {
        user_id: process.env.CLARIFAI_USER_ID,
        app_id: process.env.CLARIFAI_APP_ID
      },
      inputs: [{data: { image: {url: imageUrl}}}]
    });
    
    console.log('Making request to Clarifai API...');
    const response = await fetch("https://api.clarifai.com/v2/workflows/face-detection-workflow-j3lnei/results", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Authorization": `Key ${process.env.CLARIFAI_PAT}`,
        "Content-Type": "application/json"
      },
      body: raw
    });

    console.log('Clarifai API response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Clarifai API error response:', errorText);
      return res.status(500).json({ 
        error: 'Face detection failed', 
        details: `API returned ${response.status}`,
        apiError: errorText
      });
    }

    const data = await response.json();
    console.log('Successful response from Clarifai');
    res.json(data);
  } catch (err) {
    console.error('Detailed error:', {
      message: err.message,
      stack: err.stack,
      name: err.name
    });
    res.status(500).json({ 
      error: 'Face detection failed',
      details: err.message
    });
  }
});


app.post('/signin',(req,res)=>{
    const {email,passward}=req.body;
    db.select('*').from('login').where({email})    
    .then(data=>{
        const isvalid=bcrypt.compareSync(passward, data[0].hash); // true
        if(isvalid){
            return db.select('*')
                .from('users')
                .where({ email })
                .then(user => {
                res.json(user[0]); // send full user object
          });
        }
        else {
            res.status(400).json('unable to get user')
        }
    })
    .catch(err=>res.status(400).json('wrong credentials')) 
});
app.post('/register',(req,res)=>{
    const {name,email,passward}=req.body;
    const hash = bcrypt.hashSync(passward, saltRounds);
    db.transaction(trx=>{
        return trx.insert({
            hash:hash,
            email:email
        })
        .into('login')
        .returning('email')
        .then(loginemail=>{
            return trx('users')
            .insert({
                name:name,
                email:loginemail[0].email,
                joined:new Date()
            })
            .returning('*')
            .then(user =>{
                res.json(user[0]);
            })
        })
        .then(trx.commit)
        .catch(trx.rollback)
    })
    .catch(err => {
        res.status(400).json('unable to register');
    })
})
app.get('/profile/:id',(req,res)=>{
    const {id}=req.params;
    db.select('*').from('users').where({id})
    .then(user => {
        if(user.length){res.send(user[0])}
        else{res.status(400).json('not found') }
    })
    .catch(err=>res.status(400).json('not found'))
})
app.put('/image',(req,res)=>{
    const {id}=req.body;
    db('users').where({id})
    .increment('entries',1)
    .returning('entries')
    .then(entries=>{res.json(entries[0].entries)})
    .catch(err=>res.status(400).json('unable to get entries'))
})
const PORT = process.env.PORT || 5000;
app.listen(PORT,()=>{
    console.log('server is working');
})
