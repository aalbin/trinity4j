# Trinity4j

a declarative schema-based driver that makes working with a neo4j database through node.js easy

## setup
using t4j directly:

```
var trinity4j = require('trinity4j'),
	t4j = new trinity4j({
		schema: ["User:email", "Group:id"],
		connection: { host: 'localhost', port: '7474', username: 'neo4j', password: 'neo4j' }
	});
```

the schema is defined by an array of Label:Id combinations, where nodes with the defined labels will be indexed in the specified identifier property.
the schema and index is automatically defined if it doesn't exist when t4j is initiated in the above code example.
current limitations in this package includes only allowing single index ids for labels and lack of directionless relations.

## adding a node
```
var user = t4j.n.User('id1'),
	dbset = t4j.DbSet(user);
t4j.add(dbset, function(err,results){ ... });
```

## adding a relation to a second node
```
var node1 = t4j.ref.User('id1'),
	node2 = t4j.n.User('id2'),
	relation = node1.relTo('FriendsWith', node2, { friendshipStrength: 99 }),
	dbset = t4j.DbSet(relation);
t4j.add(dbset, function(err,results){ ... });
// only the relation and node 2 will be added as node1 is defined as a Reference
```

## modifying an existing node
```
// get existing node first, then modify existing data
t4j.get({ User: ['id1'] }, function(err, dbset){
	var user = dbset.getNode('User', 'id1'),
		data = user.data;
	data.description = 'has been updated';

	user = t4j.n.User(data);
	dbset = t4j.DbSet(user);
	t4j.set(dbset, function(error, results){ ... });
});
```

## get nodes by relation
```
var user = t4j.ref.User('id1'),
	lovers = t4j.ref.User.byRelation('InLoveWith').to(user).return();	// use to or from to define direction of relation, and chain the return command to the entity to output it in the result set
var dbset = t4j.DbSet(user, lovers);
t4j.get(dbset, function(err, results){ ... });
```

## data types
there are a couple of defined data types that we use when interfacing with t4j:

_Node_ used when adding or modifying data confined in nodes
example: new t4j.Node('Event', 'id123');
example: new t4j.n.Event('id123');

_Reference_ used as reference, when modifying or adding other nodes or relations
example: new t4j.Reference('Event', 'id123');
example: new t4j.ref.Event('id123');

_Relation_ used to define relations between nodes and/or references
example: node1.relTo('RelatesTo', node2);

_DbSet_ the type used when committing changes to the database
example: new t4j.DbSet([node1, relation]);

## get
to get all nodes with label Event:
```
t4j.get({Event:[]}, function(errors, dbset){...}, mode, verbosity);
```

to get Event node with identifier 'xyz':
```
t4j.get({Event:['xyz']}, function(errors, dbset){...}, mode, verbosity);
```

modes: all (get nodes, referenced nodes and relations), limited (get only requested nodes, relations and references to related nodes), minimal (get only requested nodes)

you can also use a DbSet like so:

```
var u = t4j.ref.User('user@email.com'),
    e = t4j.ref.Event.byRelation('relationLabel').from(u),
    dbset = t4j.get(t4j.DbSet(u, e), function(errors, dbset) {...}, mode, verbosity);
```

## set

## add

## del

## relations
add relation from node n to node t (works on both nodes an references):
```
var relation = n.relTo('RelationLabel', t),
```

adding some data to the relation:
```
var rel = n.relTo('RelationLabel', t, { foo: 'bar' });
```

## modify dbset
create node with label Event
```
t4j.Node('Event', id); or t4j.n.Event(id);
```

create reference with label Event
```
t4j.Reference('Event', id); or t4j.ref.Event(id);
```

make reference returnable in get query
```
ref.return();
```

use merge to match a node, and create it if it doesn't allready exist
```
node.merge();
```

turn node into reference (will only be used as reference in query; ie. it will not be added when used in add, will not be updated when used in set, will not be deleted when used in del)
```
node.toRef();
```

turn Reference into a Node (as the above but reversed)
```
ref.toNode();
```

detach node from dataset (will remove all relations to other nodes and also removes the relation to the dataset)
```
ref.detach / node.detach()
```

can be chained as such, for example:

```
node.detach().toRef().return();
```

add paging to dbset
```
dbset.skip(5).take(5);
```