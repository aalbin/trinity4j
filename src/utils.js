var tc = require('./typecast/index');

module.exports = new (function () {

	this.concatNeoStats = function (body) {
		stats = {};
		if (!body)
			return stats;

		if (tc.verify.is(body.results, Array))
			body.results.forEach(function (r) {
				if (tc.verify.is(r.stats, Object))
					for (var key in r.stats) {
						if (tc.verify.is(r.stats[key], Number))
							stats[key] = stats[key] ? stats[key] + r.stats[key] : r.stats[key];
						else if (tc.verify.is(r.stats[key], Boolean))
							stats[key] = stats[key] === true || r.stats[key] === true;
					}
			});

		return stats;
	};

	// return a new object, based on the object in the first parameter, that does not contain the property or properties defined in the second parameter
	this.exclude = function (object, props) {
		if (!tc.verify.is(object, Object))
			return;

		props = tc.verify.is(props, Array) ? props
			: tc.verify.is(props, String) ? [props]
				: [];

		var purified = {}
		for (var key in object) {
			if (props.indexOf(key) < 0)		// NaN values will apparently not be found in this way but who cares, right?
				purified[key] = object[key];
		}
		return purified;
	};

	this.equal = function (condition) {
		var args = Array.prototype.slice.call(arguments),
			prev, current;
		for (var i = 0; i < args.length; i++) {
			current = args[i];
			if (prev && current !== prev)
				return false;
			prev = current;
		}
		return true;
	}

	this.arrayContains = function (a, obj) {
		var i = a.length;
		while (i--) {
			if (a[i] === obj) {
				return true;
			}
		}
		return false;
	}

	this.linq = {
		using: function (array) {
			return {
				where: function (condition) {
					var filtered = [];
					if (tc.verify.is(condition, Function))
						array.forEach(function (e) {
							if (condition(e))
								filtered.push(e);
						});
					return filtered;
				},
				all: function (condition) {
					if (!tc.verify.is(condition, Function)) return false;
					for (var i = 0; i < array.length; i++) {
						if (!condition(array[i])) return false;
					}
					return true;
				},
				any: function (condition) {
					if (!tc.verify.is(condition, Function)) return false;
					for (var i = 0; i < array.length; i++) {
						if (condition(array[i])) return true;
					}
					return false;
				},
				select: function (condition) {
					var selected = [];
					if (tc.verify.is(condition, Function))
						array.forEach(function (e) {
							selected.push(condition(e));
						});
					return selected;
				},
				first: function (condition) {
					if (array.length === 0)
						return null;
					return array[0];
				},
				pushMultiple = function (other) {
					if (!tc.verify.is(other, Array)) return;
					other.forEach(function (e) {
						array.push(e);
					});
				}
			}
		}
	}

})();