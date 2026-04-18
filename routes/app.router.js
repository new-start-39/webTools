const Router = require('@koa/router');
const apiRouter = require('./api.router');
const transformDataRouter = require('./transform-data.router');

const appRouter = new Router();

appRouter.use(apiRouter.routes(), apiRouter.allowedMethods());
appRouter.use(transformDataRouter.routes(), transformDataRouter.allowedMethods());

module.exports = appRouter;
