var parse = require('./parse');

module.exports = new (function () {
	var verify = this;
	
	/* verifies whether an object is an isntance of the constructor passed as the type parameter by instanciating the type and comparing their Object prototype toString representations
	 */
	this.is = function (obj, type) {
		try {
			// the only instance I can see where this wouldn't work as intended is something like is({}, function(str){ return str != null; }); where the function passed is not Object, but would still evaluate as Object when instantiated
			return obj === type || (Object.prototype.toString.apply(type) === "[object Function]" && Object.prototype.toString.apply(obj) === Object.prototype.toString.apply(new type()));
		} 
		catch (e) {

		}
	};
	
	this.sametype = function (x, y) {
		return x === y || Object.prototype.toString.apply(x) === Object.prototype.toString.apply(y);
	}
	
	/* will return true if obj is either null, undefined, an empty string, an empty object or an empty array - otherwise returns false
	 */
	this.nullOrEmpty = function (obj) {
		if (obj === null || obj === undefined)
			return true;
		
		if (verify.is(obj, Object) && !Object.keys(obj).length)
			return true;
		
		if (verify.is(obj, String) && obj === '')
			return true;
		
		if (verify.is(obj, Array) && obj.length === 0)
			return true;
		
		return false;
	};
	
	/* evaluates an object by running the passed eval function on it
	 */
	this.eval = function (obj, type, eval) {
		if (type && !eval) eval = type;
		else obj = parse.as(obj, type);
		if (obj && verify.is(eval, Function))
			return eval(obj);
	};

});