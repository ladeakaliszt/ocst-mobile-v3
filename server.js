const express = require('express');
const path    = require('path');
const app     = express();
const PORT    = process.env.PORT || 3001;

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`OCST Mobil: http://localhost:${PORT}`);
});
