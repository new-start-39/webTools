const Koa = require('koa');
const path = require('path');
const serve = require('koa-static');
const appRouter = require('./routes/app.router');

const app = new Koa();
const PORT = process.env.PORT || 3000;

app.use(serve(path.join(__dirname, 'public')));
app.use(appRouter.routes());
app.use(appRouter.allowedMethods());

app.listen(PORT, () => {
  console.log(`Koa server is running at http://localhost:${PORT}`);
});
