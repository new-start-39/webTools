const Router = require('@koa/router');

const transformDataRouter = new Router({
  prefix: '/transform-data'
});

transformDataRouter.get('/', (ctx) => {
  ctx.body = {
    module: 'transform-data',
    message: 'transform data router is ready'
  };
});

transformDataRouter.get('/preview', (ctx) => {
  const input = ctx.query.input || '';

  ctx.body = {
    original: input,
    transformed: input.toUpperCase()
  };
});

module.exports = transformDataRouter;
