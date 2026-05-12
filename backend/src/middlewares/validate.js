/**
 * Joi 参数校验中间件
 * 用法：router.post('/path', validate(schema), controller)
 */
const { ValidationError } = require('../utils/errors');

/**
 * 创建校验中间件
 * @param {import('joi').ObjectSchema} schema - Joi schema
 * @param {string} source - 校验来源：'body' | 'query' | 'params'
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = req[source];
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const message = error.details.map(d => d.message).join('; ');
      return next(new ValidationError(message));
    }

    // 将校验后的值写回请求对象
    req[source] = value;
    next();
  };
};

module.exports = validate;
