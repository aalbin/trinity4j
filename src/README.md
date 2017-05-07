# Trinity4j

a driver to easily communicate with a neo4j database through node.js

## setup
using t4j directly:
var trinity4j = require('../../trinity4j/trinity4j'),
	t4instance = new trinity4j({
		schema: ["User:email", "Event:id", "Group:id", "Comment:id", "Locality:id", "Tag:name"],
		connection: { host: 'localhost', port: '7474', username: 'neo4j', password: 'newpw' }
	});

using a cache layer (not yet doing anything else than piping requests to t4j, but will eventually cache results):
var trinityCache = require('./trinity4j/trinity4cache'),
	t4c = new trinityCache({
		schema: ["User:email", "Event:id", "Group:id", "Comment:id", "ArchivedComment:id", "Locality:id", "Tag:name"],
		connection: { host: process.env.dbhost, port: process.env.dbport, username: process.env.dbun, password: process.env.dbpw }
	}, function (errors, results) {

		if (!errors || errors.length === 0){
			trinityCache.register(t4c);
		}
		else {
			console.error('t4c errors: ', errors);
		}
	});

## get
to get all nodes with label Event:
t4j.get({Event:[]}, function(errors, dbset){...}, mode, verbosity);

to get Event node with identifier 'xyz':
t4j.get({Event:['xyz']}, function(errors, dbset){...}, mode, verbosity);

modes: all (get nodes, referenced nodes and relations), limited (get only requested nodes, relations and references to related nodes), minimal (get only requested nodes)

you can also use a DbSet like so:
var u = t4j.ref.User('user@email.com'),
    e = t4j.ref.Event.byRelation('relationLabel').from(u),
    dbset = t4j.get(t4j.DbSet(u, e), function(errors, dbset) {...}, mode, verbosity);


## set

## add

## del

## relations
add relation from node n to node t (works on both nodes an references):
var relation = n.relTo('RelationLabel', t),

adding some data to the relation:
var rel = n.relTo('RelationLabel', t, { foo: 'bar' });

## modify dbset
create node with label Event
t4j.Node('Event', id); or t4j.n.Event(id);

create reference with label Event
t4j.Reference('Event', id); or t4j.ref.Event(id);

make reference returnable in get query
ref.return();

use merge to match node (will create the node if it doesn't exist)
node.merge();

turn node into reference (will only be used as reference in query, will not be added when used in add, will not be updated when used in set, will not be deleted when used in del)
node.toRef();

turn Reference into a Node (as the above but reversed)
ref.toNode();

detach node from dataset (will remove all relations to other nodes and also removes the relation to the dataset)
ref.detach / node.detach()

can be chained as such, for example:

node.detach().toRef().return();