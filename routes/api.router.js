const Router = require('@koa/router');

const apiRouter = new Router({
  prefix: '/api'
});

apiRouter.get('/hello', (ctx) => {
  ctx.body = {
    message: 'hello koa'
  };
});

apiRouter.get('/health', (ctx) => {
  ctx.body = {
    ok: true
  };
});

module.exports = apiRouter;
