import app from './server';

const port = parseInt(process.env.PORT || '3000', 10);
app.listen(port, () => {
  console.log(`cert-manager listening on ${port}`);
});
