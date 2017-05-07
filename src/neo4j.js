/* Data Provider for the t4j database interface
 * 
 * Lowest level data provider for the API
 * As a rule: only fetch data from here if the cache doesn't hold the data you're looking for
 * Also a rule: only call this module from the repository module, and generally never go deeper than the repository when fetching or storing data from the api application
 */

var request = require('request');
var tc = require('./typecast/index');

// request.debug = true;
// ^ uncomment to enable full debug logging of request requests

module.exports = function (connection, callback) {
	var host, port, un, pw;

	(function () {
		if (!connection || !connection.host)
			throw new Error('no connection settings found');

		host = connection.host || 'localhost';
		port = connection.port || '7474';
		un = connection.username || 'neo4j';
		pw = connection.password || 'neo4j';

		callback();
	})();

	this.runCypherQuery = function (query, params, callback, returntype, includeStats) {
		returntype = returntype || 'row';
		includeStats = tc.verify.is(includeStats, Boolean) ? includeStats : true;
		var before = new Date(),
			url = buildUrlForTransaction('/db/data/transaction/commit');

		if (!url) {
			callback(['missing neo4j url'], null);
			return;
		}

		request.post({
			uri: url,
			json: { statements: [{ statement: query, parameters: params, includeStats: includeStats, resultDataContents: [returntype] }] }
		},
			function (err, res, body) {
				var ms = Math.abs(new Date() - before);
				console.log('[neo4j response time: ' + ms + 'ms]');
				if (err && !tc.verify.is(err, Array)) {
					err = [err];
				}
				if (tc.verify.is(body && body.errors, Array)) {
					if (!err) { err = []; }
					body.errors.forEach(function (e) {
						err.push(e);
					});
				}
				callback(err, body);
			})
	};

	this.runMultipleStatements = function (options, callback, logging) {
		var queries = tc.verify.is(options.queries, Array) ? options.queries : null,
			includeStats = tc.parse.as(options.includeStats, Boolean),
			resultDataContents = tc.parse.cast(options.resultDataContents, [String]) || ['row'],
			before = new Date(),
			url = buildUrlForTransaction('/db/data/transaction/commit');

		if (!queries) {
			callback(['no queries found'], null);
			return;
		}

		if (!url) {
			callback(['missing neo4j url'], null);
			return;
		}

		var statements = [];
		queries.forEach(function (q) {
			if (tc.verify.is(q.query, String) && (tc.verify.is(q.params, Object) || !q.params)) {
				statements.push({ statement: q.query, parameters: q.params, includeStats: includeStats, resultDataContents: resultDataContents });
			}
		});
		
		request.post({
			uri: url,
			json: { statements: statements }
		}, function (err, res, body) {
			var ms = Math.abs(new Date() - before);
			console.log('[neo4j response time: ' + ms + 'ms]');

			if (err && !tc.verify.is(err, Array)) {
				err = [err];
			}

			if (tc.verify.is(body && body.errors, Array)) {
				if (!err) { err = []; }
				body.errors.forEach(function (e) {
					err.push(e);
				});
			}

			callback(err, body);
		});
	};

	// doesn't seem right - definitions have changed or the documentation is wrong, or do I miss something?
	// look into possibly needing to add some form of additional parameter to the request
	this.getIndexes = function (label, callback) {
		if (label && !tc.verify.is(label, String)) {
			var msg = 'neo4j.getIndexes: label must be a string or null if defined';
			console.warn(msg);
			callback([msg]);
			return;
		}

		var url = buildUrlForTransaction('db/data/schema/'); // + (label || ''));
		//var url = buildUrlForTransaction('/db/data/transaction/commit');
		console.log(url);

		request.post({
			uri: url
		},
			function (err, res, body) {
				callback(err, body);
			});
	};

	this.convertRowsToUsableObject = function (resp) {
		if (!resp) {
			console.error('neo4j.convertRowsToUsableObject: no response to read');
			return;
		}

		// testing on an average response object resulted in a recording of 0ms - so this is not a big deal performance wise but very nice when working with the response objects..
		if (resp.errors && resp.errors.length > 0) {
			console.error('errors: ' + JSON.stringify(resp.errors));
			return null;
		}

		if (resp.results.length < 1 || resp.results[0].columns.length < 1 || resp.results[0].data.length < 1 || resp.results[0].data[0].row.length < 1 || resp.results[0].columns.length != resp.results[0].data[0].row.length) {
			return null;
		}

		var objs = [];

		resp.results[0].data.forEach(function (data, di, da) {
			var obj = {};
			resp.results[0].columns.forEach(function (col, ci, ca) {
				obj[col] = data.row[ci];
			});
			objs.push(obj);
		});

		return objs;
	};

	this.cleanNulls = function (obj, rm) {
		for (var i in obj) {
			if (obj[i] === null || obj[i] === undefined || (rm instanceof Array && rm.indexOf(i) >= 0)) {
				delete obj[i];
			}
		}
		return obj;
	};

	var buildUrlForTransaction = function (path) {
		if (path && tc.verify.is(path, String) && path.length > 0 && path[0] !== '/')
			path = '/' + path;

		// var host = process.env.dbhost,
		// 	port = process.env.dbport,
		// 	username = process.env.dbun,
		// 	pw = process.env.dbpw;

		if (host === undefined ||
			port === undefined ||
			un === undefined ||
			pw === undefined) {
			console.error('Neo4j ERROR: host, port, username or password was missing');
			return;
		}

		var httpUrlForTransaction = 'http://' + un + ':' + pw + '@' + host + ':' + port + path;

		return httpUrlForTransaction;
	}
};

/* Create group event for group:
 * 
 * create(e:Event{name:{name},description:{description},public:{public},Id:{Id}}) with e as e match(g:Group{Id:{groupId}})<-[:MemberOf]-(u:User) create (e)<-[:InvitedTo{responded:false,response:false,seen:false}]-(u) create (g)<-[:GroupEventFor]-(e)
 * 
 * Get a user and all of it's direct relations:
 * 
 * match(u:User{email:'albin@bjorlund.com'})-[r]->(n) return u, collect({type:type(r), props:r}) as r, collect({labels:labels(n),id:ID(n),name:n.name}) as n
 * 
 * 
 * - we should also consider adding a custom ID to all items that can be updated (all items that is) - because some say the built-in ID value of neo4j cannot be trusted
 * - it may be unnecessary to add the responded, response etc values to the InvitedTo relation as undefined can be checked and we can add those values when there are actually values to be set
 */