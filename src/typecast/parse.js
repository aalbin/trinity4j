var verify = require('./verify');
var uuid_generator = require('uuid');

// TODO: scrap the whole typecast thing and find a working alternative. this is broken.

module.exports = new (function () {
	var parse = this;

	/* parses an object into the type by using it as a constructor
	 * this method is used only to parse objects into the correct primitives using constructors
	 */
	this.as = function (obj, type, def) {
		if (verify.is(obj, type))
			return obj;

		// type is assumed to be a constructor, and will be parsed as such
		if (verify.is(type, Function)) {
			try {
				// trycatch because some combinations of obj and type may cause exceptions, such as new Function({});
				var x = new type(obj),
					v = verify.is(x.valueOf, Function) ? x.valueOf() : null;
				return verify.is(v, type) ? v : x;
			}
			catch (e) {
				return cast_fallback(type, def);
			}
		}

		// type is neither, so return fallback
		else {
			return cast_fallback(type, def);
		}
	};

	/* mode:(none) - members that match the definitions are included and all otehrs are omitted
	 * mode:strict - if any member doesn't match, nothing is returned
	 * mode:fallback - members that don't match will be assigned a default value by running type(); so for custom definitions always make sure to return a default value if the parameter is undefined
	 * mode:parse - members that don't match will be parsed using parse.as
	 */
	this.cast = function (obj, type, mode) {
		mode = verify.is(mode, String) ? { type: mode } : verify.is(mode, Object) && mode.type ? mode : undefined;

		// type is assumed to be a type blueprint definition, and will be parsed as such
		if (verify.is(type, Object) && verify.is(obj, Object)) {
			var instance = {};

			for (var key in type) {
				var memType = type[key],
					value = obj[key];

				// member type is presumably a primitive Constructor (like String or Array for example), or a preset function (like cast.presets.email), so cast it as such
				if (verify.is(memType, Function) && !verify.nullOrEmpty(obj[key])) {

					// should make sure that the [object Class] of the parameter is the same as an instance of the type
					if (verify.is(value, memType)) {
						instance[key] = value;
					}

					// parse value into type if mode is set to 'parse'
					else if (mode && mode.type === 'parse') {
						instance[key] = parse.as(value, memType);
					}

					// if value is still undefined, try to match preset
					if (instance[key] === undefined) {
						var x = match_preset(memType, value, mode);
						if (x) instance[key] = x;
					}

					if (instance[key] !== undefined)
						continue;
				}

				// member type is an array, so parse each item in the instance to the type defined att memType[0]
				else if (verify.is(memType, Array) && verify.is(value, Array)) {
					instance[key] = cast_array(memType, value, mode);
				}

				// member type is an object, so cast it recursively using this method (parse.cast)
				else if (verify.is(memType, Object)) {
					var x = parse.cast(value, memType, mode);
					if (x) instance[key] = x;
				}

				// if strict, return undefined if missing parameter is referenced in the args or, if no arguments are found, any parameter is missing
				if (instance[key] === undefined && mode && mode.type === 'strict' && (!mode.args || verify.is(mode.args, Array) && mode.args.indexOf(key) !== -1))
					return undefined;

				else if (instance[key] === undefined && mode && mode.type === 'fallback' && instance[key] === undefined)
					instance[key] = memType();

				else if (instance[key] === undefined && mode && mode.type === 'parse' && value !== undefined)
					instance[key] = parse.as(value, memType);
			}

			return verify.nullOrEmpty(instance) ? undefined : instance;
		}
		else if (verify.is(type, Array) && verify.is(obj, Array)) {
			return cast_array(type, obj, mode);
		}
		else {
			return cast_fallback(type);
		}
	}

	// creates an empty instance of the provided template
	this.cast.create = function (type) {
		if (!verify.is(type, Object))
			return cast_fallback(type);

		else {
			var instance = {};

			for (var key in type) {
				var memType = type[key]
				if (verify.is(memType, Function))
					instance[key] = memType();
				else if (verify.is(memType, Object))
					instance[key] = parse.cast.create(memType);
				else if (verify.is(memType, Array) && memType.length === 1)
					instance[key] = [parse.cast.create(memType[0])];
			}

			return instance;
		}
	}

	// used to match presets in this.cast
	var match_preset = function (preset, obj, mode) {
		if (!verify.is(preset, Function))
			return;

		if (preset(obj) === true) {
			return obj;
		}

		if (mode && mode.type === 'parse') {
			// if mode is 'parse', and preset doesn't return true, return value of preset(obj)
			// case/story: we want to use the preset function as a way to parse the member instead of a way to validate it
			// not sure, maybe remove this..
			return preset(obj);
		}
	}

	// fallback for as and cast
	var cast_fallback = function (type, def) { return verify.is(type, Function) ? def && verify.is(def, type) ? def : new type() : null; }

	// we need to be able to cast arrays recursively, so the function needs to be confined in it's own variable
	var cast_array = function (type, value, mode) {
		var array = [];

		type = type[0];

		if (!verify.is(type, Function) && !verify.is(type, Object) && !verify.is(type, Array))
			return undefined;

		else {
			value.forEach(function (e, i) {
				var item;

				if (verify.is(type, Function) && verify.is(e, type))
					item = e;
				else if (verify.is(type, Function)) {
					item = match_preset(type, e, mode);
				}
				else if (verify.is(type, Object) && verify.is(e, Object))
					item = parse.cast(e, type, mode);
				else if (verify.is(type, Array) && verify.is(e, Array))
					item = cast_array(type, e, mode);

				if (!verify.nullOrEmpty(item))
					array.push(item);
			});
		}

		return array;
	}
})();
