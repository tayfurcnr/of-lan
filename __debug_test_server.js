const express = require('express');
const cors = require('cors');
const { authRouter } = require('./routes/auth');
const folderRoutes = require('./routes/folder');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/api/auth', authRouter);
app.use('/api/folder', folderRoutes);

app.listen(4123, () => console.log('test server up on 4123'));
