var n4j = require('./neo4j');
var tc = require('./typecast/index');
var async = require('async');
var utils = require('./utils'),
	linq = utils.linq;

module.exports = function (settings, init_callback) {
	var trinity4j = this,
		schema = { indices: {} },
		neo4j = null;

	this.n = {};
	this.ref = {};

	// init
	var init = function (settings, init_callback) {
		if (!settings)
			throw new Error('no settings found');

		// init constant Reference All		
		trinity4j.Reference.all = new Reference(label_all, ref_all_id);

		var sch_error = 'trinity4j initialized with missing or malformed schema',
			cn_error = 'trinity4j initialized with missing or malformed connection data',
			errs = [];

		if (!settings.connection) {
			init_callback([cn_error]);
		}
		else
			neo4j = new n4j(settings.connection, function () {
			});

		// on neo4j successful init, init schema
		if (tc.verify.is(settings.schema, Array)) {
			settings.schema.forEach(function (e, i, a) {
				if (tc.verify.is(e, String) && e.indexOf(':') > 0) {
					var index = e.split(':');
					schema.indices[index[0]] = {
						id: index[1]
					};
				}
				else {
					console.warn(sch_error);
					errs.push(sch_error);
				}
			});
		}
		else if (tc.verify.is(settings.schema, Object)) {
			for (var key in settings.schema) {
				if (tc.verify.is(settings.schema[key], Object)) {
					schema.indices[key] = tc.parse.cast(settings.schema[key], { id: String, schema: Object });
					if (!schema.indices[key].id) {
						console.warn(sch_error);
						errs.push(sch_error);
					}
				}
				else {
					console.warn(sch_error);
					errs.push(sch_error);
				}
			}
		}
		else {
			console.warn(sch_error);
			errs.push(sch_error);
		}

		var constraints = [];
		for (var key in schema.indices) {
			trinity4j.n[key] = (function (label) { return function (data) { return trinity4j.Node(label, data); } })(key);
			trinity4j.ref[key] = (function (label) { return function (id, ret) { return trinity4j.Reference(label, id, ret); } })(key);
			trinity4j.ref[key].all = new Reference(key, ref_all_id);
			trinity4j.ref[key].byRelation = nodeByRelation(new Reference(key));
			constraints.push({ query: `CREATE CONSTRAINT ON (n:${key}) ASSERT n.${schema.indices[key].id} IS UNIQUE` });
		}

		// add constraints according to schema (will do nothing if constraints are allready available)
		neo4j.runMultipleStatements({ queries: constraints, includeStats: true }, function (e, r) { init_callback(e.concat(errs), utils.concatNeoStats(r)); });
	};

	var getIndex = function (index) {
		return schema.indices[index] || {};
	}

	this.get = function (getNodes, callback, mode, logging) {
		// getNodes.label.identifier
		// callback(error, [dbset])
		// mode = 'all': return nodes, relations and related nodes (default)
		// mode = 'limited': return only requested nodes, relations and references to related nodes
		// mode = 'minimal': return only requested nodes

		if (logging === 'verbose' && getNodes instanceof DbSet)
			console.log(`*** GETTING DbSet: \n${ getNodes.toString()}`);

		if (logging === 'verbose' || logging === 'timing') var d = new Date();

		trinity4j.get.getCypher(getNodes, function (queries, errors) {
			if (logging === 'verbose' || logging === 'timing') 
				console.log(`[${(new Date() - d)}ms to build query]`);

			neo4j.runMultipleStatements({ queries: queries, resultDataContents: ['graph'] }, function (neo_error, body) {
				// we will in some cases get more data than was asked for, considering the way the cypher is formatted (by necessity) - should we return all of it or just parts of it? what is most reasonable? 
				// currently, I artificially truncate the unwanted properties in 'limited' mode, which seems kind of lame

				var dbset = buildDbSetFromNeoResult(body, { mode: mode, nodes: getNodes });
				callback(errors, dbset, queries, neo_error);
			}, logging);
		}, mode, logging);
	}

	this.add = function (dbSet, callback, mode, logging) {
		// dbset instanceof DbSet
		// callback(error, stats)
		// mode 'default': add new nodes and crash on conflict
		// mode 'merge': use merge to add new nodes and update existing ones

		if (logging === 'verbose')
			console.log(`*** CREATING DbSet: \n${ dbSet.toString()}`);

		if (logging === 'verbose' || logging === 'timing') var d = new Date();

		trinity4j.add.getCypher(dbSet, function (cypher, params, errors) {
			if (logging === 'verbose' || logging === 'timing') 
				console.log(`[${(new Date() - d)}ms to build query]`);

			neo4j.runCypherQuery(cypher, params, function (neo_error, results) {
				errors = errors.concat(flattenNeoErrors(neo_error));
				var stats = utils.concatNeoStats(results);
				callback(errors, stats, [{ query: cypher, params: params }], neo_error);
			});

		}, mode, logging);
	}

	this.set = function (dbSet, callback, mode, logging) {
		// dbset instanceof DbSet
		// callback(error, neo4j stats)
		// mode 'add': only add/overwrite using provided data (default)
		// mode 'replace': replace all data with provided data

		if (logging === 'verbose')
			console.log(`*** UPDATING DbSet: \n${ dbSet.toString()}`);

		if (logging === 'verbose' || logging === 'timing') var d = new Date();

		trinity4j.set.getCypher(dbSet, function (queries, errors) {
			if (logging === 'verbose' || logging === 'timing') 
				console.log(`[${(new Date() - d)}ms to build query]`);

			neo4j.runMultipleStatements({ queries: queries, includeStats: true }, function (neo_error, results) {
				errors = errors.concat(flattenNeoErrors(neo_error));
				var stats = utils.concatNeoStats(results);

				callback(errors, stats, queries, neo_error);
			}, logging);
		}, mode, logging);

	}

	// will return nodes_deleted equal to attempted deletes, even if there was an error such as node still has relationships or similar
	// in those cases, there will be an error message telling the user what went wrong - not optimal but what can I do? The fault is on Neo4j
	// also seems like it doesn't always return an error even if there were no deletes - possibly due to node not being found. What to do about that?
	this.del = function (dbSet, callback, mode, logging) {
		// dbSet instanceof DbSet
		// callback(errors, neo4j stats)
		// mode = 'cautious': remove nodes with active relations only if the relations are also deleted (default)
		// mode = 'detach': remove nodes even if they have active relations; implicitly deleting those relations too
		// logging = 'verbose': log generated cypher and parameters as well as status


		if (logging === 'verbose')
			console.log(`*** DELETING DbSet: \n${ dbSet.toString()}`);

		if (logging === 'verbose' || logging === 'timing') var d = new Date();

		trinity4j.del.getCypher(dbSet, function (queries, errors) {
			if (logging === 'verbose' || logging === 'timing') 
				console.log(`[${(new Date() - d)}ms to build query]`);

			neo4j.runMultipleStatements({ queries: queries, includeStats: true }, function (neo_error, results) {
				errors = errors.concat(flattenNeoErrors(neo_error));
				var stats = utils.concatNeoStats(results);

				callback(errors, stats, queries, neo_error);
			}, logging);
		}, mode, logging);

	}

	this.get.getCypher = function (getNodes, callback, mode, logging) {
		var errors = [], queries = [];

		if (getNodes instanceof DbSet) {
			var cypher = "",
				params = {},
				merge = mode === 'merge';

			var addReference = function (n) {
				// add reference to cypher using match
				// as the iterator should always handle references first it should not be a problem to make it this simple, in theory

				cypher += `match ${nodeMatch(n)}\n`;
				params[n.__key] = n.identifier;
			};

			var addReferenceByRelation = function (n) {
				// add reference-by-relation to cypher using match on both vertices and relating them

				cypher += `match ${referenceMatchByRelation(n)}\n`;
			}

			var addNode = null;

			var addNodeByRelation = null;

			var addBundle = null;

			var addRelation = null;

			var returnHandler = function (keys) {
				cypher += `return ${keys.join(',')}`;
			}

			iterateDbSet(getNodes, addReference, addReferenceByRelation, addNode, addNodeByRelation, addBundle, addRelation, returnHandler, function (errors) {
				// callback

				if (logging === 'verbose') {
					console.log('\ncypher:', `\n${cypher}`);
					console.log(`${JSON.stringify(params, null, 2)}\n`);
				}

				queries.push({ query: cypher, params: params });
			});
		}

		else if (tc.verify.is(getNodes, Object)) {
			for (var key in getNodes) {
				if (tc.verify.is(getNodes[key], String))
					getNodes[key] = [getNodes[key]];	// push to array if arg is string 

				if (tc.verify.is(getNodes[key], Array)) {	// assume array

					var index = getIndex(key).id,
						cypher = `MATCH (n1:${key})
							${(tc.verify.is(getNodes[key], Array) && !tc.verify.nullOrEmpty(getNodes[key]) ? ` where n1.${index} in {identifiers}` : "")}
							${(mode !== 'minimal' ? " optional match(n1)-[r]-(n2)" : "")} RETURN n1 as node
							${(mode !== 'minimal' ? ", collect({type:type(r),data:r,node: { label:labels(n2)[0],is_target:endnode(r)=n2,data:n2 }}) as relations" : "")}`;

					queries.push({ query: cypher, params: { identifiers: getNodes[key] } });
				}
			}
		}
		else { errors.push('invalid input'); }

		if (logging === 'verbose') {
			queries.forEach(function (q) {
					console.log('\ncypher:', `\n${q.query}`);
					console.log(`${JSON.stringify(q.params, null, 2)}\n`);
			});
		}

		callback(queries, errors);
	}

	this.add.getCypher = function (dbSet, callback, mode, logging) {

		// *** TODO: check on how to avoid injections on merge, b/c we need to omit using parameters on them 

		var cypher = "",
			params = {},
			merge = mode === 'merge';

		var addReference = function (n) {
			// add reference to cypher using match
			// as the iterator should always handle references first it should not be a problem to make it this simple, in theory

			if (merge || n.commit_as_merge === true)
				cypher += `merge ${nodeMerge(n)}\n`;
			else
				cypher += `match ${nodeMatch(n)}\n`;
			params[n.__key] = n.identifier;
		};

		var addReferenceByRelation = function (n) {
			// add reference-by-relation to cypher using match on both vertices and relating them

			n.identifier.forEach((id) => {
				cypher += `match ${referenceMatchByRelation(n, id)}\n`;
			})
		}

		var addNode = function (n) {
			// add node to cypher

			if (merge || n.commit_as_merge === true)
				cypher += `merge ${nodeMerge(n)}\n`;
			else
				cypher += `create ${nodeCreate(n)}\n`;
			params[n.__key] = n.data;
		};

		var addNodeByRelation = null;

		var addBundle = function (r, fr, to) {
			// add combined fragment to cypher

			if (merge || linq.using([r, fr, to]).all((n) => n.commit_as_merge === true)) {
				// everything should be merged
				if (fr instanceof Node)
					cypher += `merge ${nodeMerge(fr)}\n`;
				if (to instanceof Node)
					cypher += `merge ${nodeMerge(to)}\n`;
				cypher += `merge ${nodeRef(fr)}-${relationRef(r)}->${nodeRef(to)}${onCreateSet(r)}\n`;
			}
			else if (linq.using([r, fr, to]).any((n) => n.commit_as_merge === true)) {
				// some things should be merged
				if (fr.commit_as_merge === true)
					cypher += `merge ${nodeMerge(fr)}\n`;
				else if (fr instanceof Node)
					cypher += `create ${nodeCreate(fr)}\n`;

				if (to.commit_as_merge === true)
					cypher += `merge ${nodeMerge(to)}\n`;
				else if (to instanceof Node)
					cypher += `create ${nodeCreate(to)}\n`;

				cypher += `merge ${nodeRef(fr)}-${relationRef(r)}->${nodeRef(to)}${onCreateSet(r)}\n`;
			}
			else {
				cypher += `create ${(fr instanceof Reference ? nodeRef(fr) : nodeCreate(fr))}-${relationCreate(r)}->${(to instanceof Reference ? nodeRef(to) : nodeCreate(to))}\n`;

				if (fr instanceof Node)
					params[fr.__key] = fr.data;
				if (to instanceof Node)
					params[to.__key] = to.data;
				params[r.__key] = r.data;
			}
		};

		var addRelation = function (n) {
			// add create relation fragment to cypher
			if (merge || n.commit_as_merge) {
				cypher += `merge ${nodeRef(n.from)}-${relationRef(n)}->${nodeRef(n.to)}${onCreateSet(n)}\n`;
			} else {
				cypher += `create ${nodeRef(n.from)}-${relationCreate(n)}->${nodeRef(n.to)}\n`;
			}
			params[n.__key] = n.data;
		};

		var returnHandler = function (keys) {
			cypher += `return ${keys.join(',')}`;
		}

		iterateDbSet(dbSet, addReference, addReferenceByRelation, addNode, addNodeByRelation, addBundle, addRelation, returnHandler, function (errors) {
			// callback

			if (logging === 'verbose') {
				console.log('\ncypher:', `\n${cypher}`);
				console.log(`${JSON.stringify(params, null, 2)}\n`);
			}

			callback(cypher, params, errors);
		});
	}

	this.set.getCypher = function (dbSet, callback, mode, logging) {

		var queries = [],
			operator = mode === 'replace' ? '=' : '+=',
			stats;

		// references on their own do not need separate handling in this scenario
		var handleReference = null;
		var handleReferenceByRelation = null;

		var handleNode = function (n) {
			// handle node
			var m = `match ${nodeMatch(n)}\n`,
				s = `set ${n.__key} ${operator} {${n.__key}$data}\n`,
				p = {};
			p[n.__key] = n.identifier;
			p[`${n.__key}$data`] = n.data;	// I intentionally don't flush the identifier from the data because replace mode would remove the indexer from the node if I did

			queries.push({ query: m + s, params: p });
		};

		var handleNodeByRelation = function (n) {
			var other = n.identifier.vertex, q = "", p = {}, set = "";

			while (other && other.identifier instanceof IdentityByRelation) {
				q = `match ${referenceMatchByRelation(other)}\n${q}`;
				other = other.identifier.vertex;
			}
			if (other instanceof Node || other instanceof Reference) {
				q = `match ${nodeMatch(other)}\n${q}`;
				p[other.__key] = other.identifier;
			}
			q += `match ${referenceMatchByRelation(n)}\n`;
			q += `set ${n.__key} ${operator} {${n.__key}}\n`;
			p[n.__key] = n.data;

			// will only set relation data for the relation referenced directly by the node - adding reldata to any referenced node-by-relation will not be set here but in the specific query for that node-by-relation, and ref-by-relation cannot hold any data on the relation or the node
			if (n.identifier.data) {
				var reldkey = n.__key + n.identifier.vertex.__key;
				p[reldkey] = n.identifier.data;
				q += `set ${reldkey} ${operator} {${reldkey}}\n`;
			}
			queries.push({ query: q, params: p });
		}

		var handleBundle = function (r, fr, to) {
			// handle node-relation-node bundle
			var m = `match ${nodeMatch(fr)}-${relationRef(r)}->${nodeMatch(to)}\n`,
				s = `set ${r.__key} ${operator} {${r.__key}}`,
				p = {};
			p[r.__key] = r.data;

			[fr, to].forEach(function (n) {
				if (n instanceof Node) {
					s += `, ${n.__key} ${operator} {${n.__key}$data}`;
					p[`${n.__key}$data`] = n.data;
				}
				p[n.__key] = n.identifier;
			});

			queries.push({ query: m + s, params: p });
		};

		var handleRelation = function (r) {
			// handle relation
			var m = `match ${nodeMatch(r.from)}-${relationRef(r)}->${nodeMatch(r.to)}\n`,
				s = `set ${r.__key} ${operator} {${r.__key}}\n`,
				p = {};
			p[r.__key] = r.data;
			p[r.to.__key] = r.to.identifier;
			p[r.from.__key] = r.from.identifier;

			queries.push({ query: m + s, params: p });
		};

		var returnHandler = null;

		iterateDbSet(dbSet, handleReference, handleReferenceByRelation, handleNode, handleNodeByRelation, handleBundle, handleRelation, returnHandler, function (errors) {
			if (logging === 'verbose') {
				queries.forEach(function (q) {
					console.log('\ncypher:', `\n${q.query}`);
					console.log(`${JSON.stringify(q.params, null, 2)}\n`);
				});
			}

			callback(queries, errors);
		});
	}

	this.del.getCypher = function (dbSet, callback, mode, logging) {

		var queries = [],
			delPrefix = mode === 'detach' ? 'detach ' : '',
			stats;

		// references on their own do not need separate handling in this scenario, and will not be considered unless needed in a bundle or relation
		var handleReference = null;
		var handleReferenceByRelation = null;

		var handleNode = function (n) {
			// handle node
			var m = `match ${nodeMatch(n)}\n`,
				d = `${delPrefix}delete ${n.__key}\n`,
				p = {};
			p[n.__key] = n.identifier;

			queries.push({ query: m + d, params: p });
		};

		var handleNodeByRelation = function (n) {
			var other = n.identifier.vertex, q = "", p = {};

			while (other && other.identifier instanceof IdentityByRelation) {
				q = `match ${referenceMatchByRelation(other)}\n${q}`;
				other = other.identifier.vertex;
			}
			if (other instanceof Node || other instanceof Reference) {
				q = `match ${nodeMatch(other)}\n${q}`;
				p[other.__key] = other.identifier;
			}
			q += `match ${referenceMatchByRelation(n)}\n`;
			q += `${delPrefix}delete ${n.__key}\n`;
			queries.push({ query: q, params: p });
		}

		var handleBundle = function (r, fr, to) {
			// handle node-relation-node bundle
			var m = `match ${nodeMatch(fr)}-${relationRef(r)}->${nodeMatch(to)}\n`,
				d = `${delPrefix}delete ${r.__key}`,
				p = {};

			[fr, to].forEach(function (n) {
				if (n instanceof Node) {
					d += ', ' + n.__key;
					p[n.__key] = n.identifier;
				}
			});

			queries.push({ query: `${m}${d}\n`, params: p });
		};

		var handleRelation = function (r) {
			// handle relation
			var m = `match ${nodeMatch(r.from)}-${relationRef(r)}->${nodeMatch(r.to)}\n`,
				d = `${delPrefix}delete ${r.__key}\n`,
				p = {};
			p[r.to.__key] = r.to.identifier;
			p[r.from.__key] = r.from.identifier;

			queries.push({ query: m + d, params: p });
		};

		var returnHandler = null;

		iterateDbSet(dbSet, handleReference, handleReferenceByRelation, handleNode, handleNodeByRelation, handleBundle, handleRelation, returnHandler, function (errors) {
			// callback

			if (logging === 'verbose') {
				queries.forEach(function (q) {
					console.log('\ncypher:', `\n${q.query}`);
					console.log(`${JSON.stringify(q.params, null, 2)}\n`);
				});
			}

			callback(queries, errors);
		});
	}

	this.cypher = function (cypher, params, callback, mode, logging) {
		// cypher = valid neo4j cypher query string
		// params = object containing parameters referenced in cypher
		// callback(errors, {data, stats}, [], neo_error)
		// mode (not used)
		// logging = 'verbose': log full resultset

		var statements = { queries: [{ query: cypher, params: params }], includeStats: true, resultDataContents: ['graph'] };
		neo4j.runMultipleStatements(statements, function (neo_error, results) {
			if (logging === 'verbose')
				console.log(JSON.stringify(results, null, 2));
			var stats = utils.concatNeoStats(results),
				dbset = buildDbSetFromNeoResult(results),
				errors = flattenNeoErrors(neo_error);
			callback(errors, { data: dbset, stats: stats }, [], neo_error);
		});
	}

	this.drop = function (callback) {
		// drop constraints added by this instance - only intended for testing purposes when schemas have been created and need to be dropped again at the end of the test
		var constraints = [];
		for (var index in schema.indices) {
			constraints.push({ query: `DROP CONSTRAINT ON (n:${index}) ASSERT n.${schema.indices[index].id} IS UNIQUE` })
		}
		console.warn('\n*** dropping trinity4j schema ***\n');
		neo4j.runMultipleStatements({ queries: constraints, includeStats: true }, function (e, r) {
			callback(e, utils.concatNeoStats(r));
		});
	}

	var iterationHandlers = {

		// todo: move all iteration handlers into this structure to improve performance by not creating new functions on each execution
		// todo: figure out a smart way to pass request-specific query variables and such that are now in the same context as the handlers but no longer would be if they were moved into here

		add: {

		},
		set: {

		},
		del: {

		}
	}

	// define classes

	var symaddrel = Symbol("addrelations_hiddenfunction");
	var ref_all_id = Symbol("Reference All");
	var label_all = Symbol("Label All");
	var type_all = Symbol("Type All");
	this.symbols = {
		referenceAll: ref_all_id,
		labelAll: label_all,
		typeAll: type_all
	}

	var Node = function (label, data) {
		var node = this;

		this.label = label;
		this.data = data;
		this.identifier = getIdentifier(label, data);	// use schema/index to extract value of identifier from data
		this.commit_as_merge = false;

		this[symaddrel] = addRelations(node, Relation);
		this.relTo = createRelation(node);
		this.getRels = getRelations(node);
		this.detach = detachNode(node);
		this.byRelation = nodeByRelation(node);
		this.byIdentifier = nodeById(node);
		this.merge = function () { node.commit_as_merge = !node.commit_as_merge; return node; }

		// "downgrade" Node to Reference and make sure all pointers are moved to the new object
		this.toRef = function () {
			var ref = new Reference(node.label, node.identifier);
			return transferRelations(node, ref);
		}
	}

	var Reference = function (label, identifier, ret) {
		var ref = this,
			index = getIndex(label);

		this.label = label;
		this.identifier = identifier;
		this.ret = ret === 'return';
		// this.commit_as_merge = false;

		this[symaddrel] = addRelations(ref, Relation);
		this.relTo = createRelation(ref);
		this.getRels = getRelations(ref);
		this.detach = detachNode(ref);
		this.byRelation = nodeByRelation(ref);
		this.byIdentifier = nodeById(ref);

		// "upgrade" Reference to Node and make sure all pointers are moved to the new object
		this.toNode = function (data) {
			if (tc.verify.is(ref.identifier, Array)) {
				console.warn('can only convert single reference to Node');
				return;
			}

			data = data || {};
			if (data[getIndex(ref.label).id] !== ref.identifier)
				return;

			var n = new Node(label, data);
			return transferRelations(ref, n);
		}

		this.return = function () { this.ret = !this.ret; return this; }
		// this.merge = function () { ref.commit_as_merge = !ref.commit_as_merge; return ref; }
	}

	var IdentityByRelation = function (type, vertex, direction, data) {
		this.vertex = vertex;
		this.type = type;
		this.direction = direction;
		this.data = data;
	}

	var Relation = function (fromNode, type, toNode, data) {
		var relation = this;

		this.from = fromNode;
		this.type = type;
		this.to = toNode;
		this.data = data;
		this.sym = Symbol.for([fromNode.label.toString(), fromNode.identifier.toString(), type.toString(), toNode.label.toString(), toNode.identifier.toString()]);	// => .toString() because they can be Symbols
		this.commit_as_merge = false;

		this.merge = function () { relation.commit_as_merge = !relation.commit_as_merge; return relation; }
	}

	var DbSet = function (input) {
		var input = tc.verify.is(input, Array) ? input : Array.prototype.slice.call(arguments),
			relation_index = {},
			relations = [],
			nodes = [],
			dbset = this;

		input.forEach(function (obj) {
			if (obj instanceof Node || obj instanceof Reference) nodes.push(obj);
			else if (obj instanceof Relation) relations.push(obj);
		});

		(function (nodes, relations) {
			dbset.nodes = [];
			dbset.references = [];
			dbset.relations = [];
			dbset.paging = {
				skip: undefined,
				take: undefined
			};

			if (tc.verify.is(nodes, Array)) {
				nodes.forEach(function (n) {
					if (n instanceof Node)
						dbset.nodes.push(n);
					if (n instanceof Reference)
						dbset.references.push(n);
				});
			}

			if (tc.verify.is(relations, Array)) {
				relations.forEach(function (r) {
					if (r instanceof Relation) {

						// add both to visible list and enclosed index
						dbset.relations.push(r);
						relation_index[r.sym] = r;

						[r.from, r.to].forEach(function (vertex) {
							if (!vertex.error && (vertex instanceof Node || vertex instanceof Reference)) {
								vertex[symaddrel](r);
								if (vertex instanceof Node && !utils.arrayContains(dbset.nodes, vertex))
									dbset.nodes.push(vertex);
								else if (vertex instanceof Reference && !utils.arrayContains(dbset.references, vertex))
									dbset.references.push(vertex);
							}
						});
					}
				});
			}

		})(nodes, relations);

		this.getNodes = function (label) {
			var nodes = linq.using(dbset.nodes).where(function (n) { if (!label || n.label === label) return n; })
				.concat(linq.using(dbset.references).where(function (n) { if (!label || n.label === label) return n; }));
			return nodes;
		}

		this.getNode = function () {
			var label, id;
			if (arguments.length === 1 && tc.verify.is(arguments[0], String) && arguments[0].indexOf(':') >= 0) {
				label = arguments[0].split(':')[0];
				id = arguments[0].split(':')[1];
			}
			else if (arguments.length === 2) {
				label = arguments[0];
				id = arguments[1];
			}
			else
				return;

			for (var i = 0; i < dbset.nodes.length; i++) {
				if (dbset.nodes[i].label === label && dbset.nodes[i].identifier === id)
					return dbset.nodes[i];
			}

			for (var i = 0; i < dbset.references.length; i++) {
				if (dbset.references[i].label === label && dbset.references[i].identifier === id)
					return dbset.references[i];
			}
		}

		this.dump = function (mode) {
			if (dbset.references.length && (!mode || mode === 'reference'))
				return dbset.references.shift();
			else if (dbset.nodes.length && (!mode || mode === 'node'))
				return dbset.nodes.shift();
			else if (dbset.relations.length && (!mode || mode === 'relation'))
				return dbset.relations.shift();
			else
				return;
		}

		this.getbysym = function (symbol) {
			return relation_index[symbol];
		}

		this.skip = function (n) {
			dbset.paging.skip = n;
			return dbset;
		}

		this.take = function (n) {
			dbset.paging.take = n;
			return dbset;
		}
	}

	Node.prototype.toString = function () {
		return `Node(${this.label}:${this.identifier}) ~data:${Object.keys(this.data || {}).length}`;
	}

	Reference.prototype.toString = function () {
		return `Reference(${this.label.toString()}:${this.identifier.toString()})`;
	}

	IdentityByRelation.prototype.toString = function () {
		return `ByRelation(${this.type}${this.direction}${this.vertex.toString()})${(this.data ? ` ~data:${Object.keys(this.data).length}` : "")}`;
	}

	Relation.prototype.toString = function () {
		return `Relation(${this.from.label.toString()}:${this.from.identifier.toString()} -[${this.type.toString()}]-> ${this.to.label.toString()}:${this.to.identifier.toString()}) ~data:${Object.keys(this.data || {}).length}`;
	}

	DbSet.prototype.toString = function () {
		return JSON.stringify(this, function (key, val) {
			if (val instanceof Node || val instanceof Reference || val instanceof Relation)
				return val.toString();
			else
				return val;
		}, 2)
	}

	// wrap classes in builder functions with validation so that invalid input returns undefined instead of an invalid instance
	this.Node = function (label, data) {
		var index = getIndex(label);
		if (index.id && data) {
			if (tc.verify.is(data, String)) {
				var d = {};
				d[index.id] = data;
				data = d;
			}
			if (tc.verify.is(data, Object)) // && data[index.id])	// temporarily removing requirement for Node to include an identifier - can be added as a relation later
				return new Node(label, data);
		}
	}
	this.Reference = function (label, identifier, ret) {
		var index = getIndex(label);
		if (index) { // .id && identifier) {	//temporarily removing requirement for Reference to include an identifier - can be added later by chaining 
			return new Reference(label, identifier, ret);
		}
	}
	this.Relation = function (fromNode, type, toNode, data) {
		if ((fromNode instanceof Node || fromNode instanceof Reference)
			&& (toNode instanceof Node || toNode instanceof Reference)
			&& (tc.verify.is(type, String) || type === type_all)
			&& (!data || tc.verify.is(data, Object)))
			return new Relation(fromNode, type, toNode, data);
	}
	this.DbSet = function (input) {
		input = tc.verify.is(input, Array) ? input : Array.prototype.slice.call(arguments);
		return new DbSet(input);
	}


	var nodeCreate = (n) => `(${n.__key}:${n.label} {${n.__key}})`;
	var nodeMatch = function (n) {
		var index = getIndex(n.label),
			ending = n.identifier === ref_all_id
				? ")"
				: tc.verify.is(n.identifier, Array)
					? `) where ${n.__key}.${(index ? index.id : undefined)} in {${n.__key}}`
					: ` {${index.id}: { ${n.__key} } })`;
		return `(${n.__key}${(n.label === label_all ? "" : `:${n.label}`)}${ending}`;
		// is this too complex to read? could be refactored to something like "if n.identifier is Array, else if n.identifier === ref_all_id, else ..", where the n.label === label_all check is done in all scenarios.
	}
	var nodeRef = (n) => `(${n.__key})`;
	var nodeMerge = (n) => `(${n.__key}:${n.label} {${getIndex(n.label).id}:${JSON.stringify(n.identifier)}})${onCreateSet(n)}`;
	var referenceMatchByRelation = function (n, id) {
		id = id || n.identifier;
		var dir = id.direction;
		if (dir !== '<-' && dir !== '->') return "";

		var matchThis = `(${n.__key}:${n.label})`,
			matchThat = `(${id.vertex.__key})`;
		return `${(dir === '<-' ? matchThat : matchThis)}-[${getRelationKey(n, id)}${(id.type === type_all ? "" : ":" + id.type)}]->${(dir === '->' ? matchThat : matchThis)}`;
	}
	var relationCreate = (r) => `[${r.__key}${(r.type === type_all ? "" : ":" + r.type)}${(r.data ? `{${r.__key}}` : "")}]`;
	var relationRef = (r) => `[${r.__key}${(r.type === type_all ? "" : ":" + r.type)}]`;

	var getIdentifier = function (label, data) {
		var index = getIndex(label).id;
		if (!index)
			return;

		var id = data[index];
		return id;
	}

	var getRelationKey = (n, id) => { id = id || n.identifier; return n.__key + id.vertex.__key; }


	var addRelations = function (node) {
		return function (relations) {
			relations = tc.verify.is(relations, Array) ? relations : Array.prototype.slice.call(arguments);

			relations.forEach(function (r, i, a) {
				if (!(r instanceof Relation))
					return;

				// when caching, switch out these arrays for arrays of Symbols acting as symlinks to the relations as they are positioned in the relations cache (Symbols can be used as keys in node-cache - symlinks! :)
				if (r.from === node) {
					node["->"] = node["->"] || [];
					node["->"].push(r);
				}
				else if (r.to === node) {
					node["<-"] = node["<-"] || [];
					node["<-"].push(r);
				}
			});

			node.shiftrel = function () {
				if (node["<-"] && node["<-"].length)
					return node["<-"].shift();
				else if (node["->"] && node["->"].length)
					return node["->"].shift();
			}
		}
	};

	var createRelation = function (self) {
		return function (type, target, data) {
			if (tc.verify.is(target, Array)) {
				var rels = [];
				target.forEach(function (t) {
					var r = trinity4j.Relation(self, type, t, data);
					if (r) rels.push(r);
				});
				return rels;
			}
			else
				return trinity4j.Relation(self, type, target, data);
		}
	}

	var getRelations = function (self) {
		return function (type) {
			var rels = (self['<-'] || []).concat(self['->'] || []);
			if (!type) return rels;
			else return linq.using(rels).where(function (r) { return r.type === type; });
		}
	}

	var nodeByRelation = function (node) {
		if (node instanceof Node || node instanceof Reference)
			return function (type, data) {
				return {
					to: byRelToOrFrom(node, type, data, '->'),
					from: byRelToOrFrom(node, type, data, '<-')
				}
			}
	}

	var byRelToOrFrom = function (node, type, data, direction) {
		return function (target) {
			var ibr = new IdentityByRelation(type, target, direction, data);
			if (node.identifier instanceof IdentityByRelation) {
				node.identifier = [node.identifier];
				node.identifier.push(ibr);
			}
			else {
				node.identifier = ibr;
			}
			node.andBy = nodeByRelation(node);
			return node;
		}
	}

	var nodeById = function (node) {
		if (node instanceof Node || node instanceof Reference)
			return function (identifier) {
				node.identifier = identifier;
				return node;
			}
	}

	var detachNode = function (self) {
		return function () {
			self['<-'] = [];
			self['->'] = [];
			return self;
		}
	}

	var transferRelations = function (from, to) {
		to["<-"] = from["<-"];
		to["->"] = from["->"];

		if (tc.verify.is(to["<-"], Array))
			to["<-"].forEach(function (r) { if (r.from === from) r.from = to; else if (r.to === from) r.to = to; });
		if (tc.verify.is(to["->"], Array))
			to["->"].forEach(function (r) { if (r.from === from) r.from = to; else if (r.to === from) r.to = to; });

		return to;
	}

	var iterateDbSet = function (dbSet, refHandler, refByRelHandler, nodeHandler, nodeByRelHandler, bundleHandler, relHandler, returnHandler, callback) {
		// dbSet instanceof DbSet
		// refHandler(n);
		// refByRelHandler(n);			// reference.identifier will be an array when sent to this handler (but not when sent to the nodeByRelHandlern)
		// nodeHandler(n);
		// bundleHandler(r,fr,to);		// bundles nodes that haven't yet been handled and/or references that have been handled with relations that have not yet been handled
		// relHandler(n);
		// returnHandler(marked, unmarked);
		// callback(errors);

		var errors = [];

		if (dbSet instanceof DbSet) {
			var i = 0,
				all = [],
				params = {},
				ret = [],
				obj, key;

			// we need to add "match" clauses first, then we try to jointly add nodes and relations, and lastly any remaining relations will be inserted as creates - thus this order
			while (obj = dbSet.dump('reference') || dbSet.dump('node') || dbSet.dump('relation')) {
				key = `n${(++i)}`;
				obj.__key = key;
				all.push(obj);
			}

			// dbSet has been consumed. GC: please dump it
			dbSet = null;

			var n;
			while (n = all.shift()) {
				if (n.ret && ret.indexOf(n.__key) === -1) {
					ret.push(n.__key);
					if (n.identifier instanceof IdentityByRelation) {
						var rk = getRelationKey(n);
						if (ret.indexOf(rk) === -1)
							ret.push(rk);
					}
				}

				if (n instanceof Reference) {
					console.log(`handling ref ${n.__key}`);
					n.identifier = n.identifier instanceof IdentityByRelation ? [n.identifier] : n.identifier;
					if (tc.verify.is(n.identifier, Array) && tc.verify.is(refByRelHandler, Function)) {
						if (!n.identifier.some((id) => {
							if (all.indexOf(n.identifier.vertex) >= 0) {
								all.splice(all.indexOf(n.identifier.vertex) + 1, 0, n);	// reinsert n after other vertex if other vertex has not yet been handled
								return true;
							}
						})) {	// if some iteration of identifier short circuits (ie. it discovers it needs to happen after another vertex), we will not go forward yet
							refByRelHandler(n);
						}
					}
					else if (tc.verify.is(refHandler, Function)) {
						refHandler(n);
					}
				}

				else if (n instanceof Node) {
					var added = false;

					if (n.identifier instanceof IdentityByRelation && tc.verify.is(nodeByRelHandler, Function)) {
						nodeByRelHandler(n);
						added = true;
					}

					else if (!(n.identifier instanceof IdentityByRelation) && tc.verify.is(bundleHandler, Function)) {
						if (n.shiftrel) {

							r = n.shiftrel()

							// check if shifted relation returned something and that the relation hasn't allready been added		
							if (r instanceof Relation && all.indexOf(r) >= 0) {

								// define n2 and set correct to/fr vars
								switch (r.from === n) {
									case true:
										to = n2 = r.to;
										fr = n;
										break
									case false:
										fr = n2 = r.from;
										to = n;
										break;
								}

								// make sure that the target of relation is either a node that haven't yet been added (aka it can be created) or a reference that has been added (aka can be used as a node reference)
								if (utils.equal(to.commit_as_merge, fr.commit_as_merge, r.commit_as_merge) && ((all.indexOf(n2) >= 0 && n2 instanceof Node) || (all.indexOf(n2) <= -1 && n2 instanceof Reference))) {
									added = true;

									// finally splice the relation and target node from the looping array ( but don't use the returned objects as they seem to be undefined for some reason )
									all.splice(all.indexOf(r), 1);
									if (all.indexOf(n2) >= 0)
										all.splice(all.indexOf(n2), 1);

									// handle bundle								
									bundleHandler(r, fr, to);
								}
							}
						}
					}

					if (!added && tc.verify.is(nodeHandler, Function)) {
						nodeHandler(n);
					}
				}

				else if (n instanceof Relation && tc.verify.is(relHandler, Function)) {
					relHandler(n);
				}
			}

			if (ret.length > 0 && tc.verify.is(returnHandler, Function)) {
				returnHandler(ret, all);
			}
		} else {
			errors.push('invalid input');
			callback(errors);
		}

		callback(errors);
	}

	var buildDbSetFromNeoResult = function (body, get) {
		var nodes = [], relations = [], temprels = [];
		body && body.results && body.results.forEach(function (result) {
			result && result.data && result.data.forEach(function (data) {
				data && data.graph && data.graph.nodes && data.graph.nodes.forEach(function (node) {
					var label = node.labels[0], n;
					if (label) {
						if (get && get.mode === 'limited') {
							// this is kind of artificial so I'm not sure I want to keep this mode 
							var index = getIndex(label).id, id = node.properties[index];
							if (!get.nodes[label] || get.nodes[label].indexOf(id) < 0)
								n = trinity4j.Reference(label, id);
						}

						n = n || trinity4j.Node(node.labels[0], node.properties);
						if (n)
							nodes[node.id] = n;
					}
				});
				data && data.graph && data.graph.relationships && data.graph.relationships.forEach(function (rel) {
					temprels[rel.id] = rel;
				});
			});
		});

		var relations = [];
		temprels.forEach(function (relation) {
			var from = nodes[relation.startNode],
				to = nodes[relation.endNode];
			if (from && to && relation.type)
				relations.push(new Relation(from, relation.type, to, relation.properties));
		});
		var dbset = new DbSet(nodes.concat(relations));
		return dbset;
	}

	var flattenNeoErrors = function (neo_error) {
		var errors = [];
		(neo_error || []).forEach(function (e) {
			if (tc.verify.is(e, String))
				errors.push(e);
			else if (e && e.message && tc.verify.is(e.message, String))
				errors.push(`[${e.code}]${e.message}`);
		});
		return errors;
	}

	var onCreateSet = function (n) {
		var str = "",
			data = tc.verify.is(n.data, Object) ? n instanceof Relation ? n.data : utils.exclude(n.data, getIndex(n.label).id) : {};

		for (var key in data) {
			if (data[key]) {
				if (str.length > 0)
					str += ', ';
				str += `${n.__key}.${key} = ${JSON.stringify(data[key])}`;
			}
		}
		return (str.length > 0 ? ' on create set ' : '') + str;
	}

	init(settings, init_callback);
};