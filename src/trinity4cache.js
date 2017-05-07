var nodeCache = require("node-cache"),
	trinity = require("./trinity4j");

module.exports = function (options, init_callback) {
	var cache, t4j, initiated = false,
		initerror = new Error('trinity4cache must be initiated'),
		t4c = this;

	(function () {
		if (!options) throw new Error('no options parameter was sent');

		cache = new nodeCache({ stdTTL: options.stdTTL, checkperiod: options.checkperiod });
		t4j = new trinity({ schema: options.schema, connection: options.connection }, function (errors, results) {
			if (!errors || (errors && !errors.length)) {
				initiated = true;
				t4c.t = t4j;
			}
			init_callback(errors, results);
		});
	})();

	/* TODO:
	 * make .get take a dbset of references as input
	 * 
	 */

	this.add = function (dbset, callback, mode, logging) {
		if (!initiated)
			throw initerror;

		// passthrough for now
		t4j.add(dbset, callback, mode, logging);
	};

	this.set = function (dbset, callback, mode, logging) {
		if (!initiated)
			throw initerror

		// passthrough for now
		t4j.set(dbset, callback, mode, logging);
	};

	this.get = function (dbset, callback, mode, logging) {
		if (!initiated)
			throw initerror

		// passthrough for now
		t4j.get(dbset, callback, mode, logging);
	};

	this.del = function (dbset, callback, mode, logging) {
		if (!initiated)
			throw initerror

		// passthrough for now
		t4j.del(dbset, callback, mode, logging);
	};
};

module.exports.instance;
module.exports.register = function (t4c) {
	if (t4c instanceof module.exports)
		module.exports.instance = t4c;
} 
