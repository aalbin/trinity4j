# Trinity4j

a declarative schema-based driver smoothifying node.js-neo4j integrations

## setup
declaring an instance of trinity4j:

```
var trinity4j = require('trinity4j'),
	t4j = new trinity4j({
		schema: ["User:email", "Group:id"],
		connection: { host: 'localhost', port: '7474', username: 'neo4j', password: 'neo4j' }
	});
```

the schema is defined by an array of Label:Id combinations, where nodes with the defined labels will be indexed in the specified identifier property.
the schema and indices are automatically added to neo4j if they don't exist when t4j is initiated.

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
    lovers = t4j.ref.User.byRelation('InLoveWith').to(user).return(),	// use to or from to define direction of relation, and chain the return command to the entity to output it in the result set
    dbset = t4j.DbSet(user, lovers);
t4j.get(dbset, function(err, results){ ... });
```

## add tag to all messages sent by me to users in groups that I am a member of
aka 'really complex example' 
```
	// this is me, hi!
var me = t4j.ref.User('albin@realdomain.com'),                  

	// find all groups that I am a member of
    group = t4j.ref.Group.byRelation('MemberOf').from(me),      

	// find all members of those groups
    members = t4j.ref.User.byRelation('MemberOf').to(group),    

	// find all messages that I have sent to those users
    messages = t4j.ref.Message.byRelation('SentTo').to(members).andBy('SentFrom').from(me),   
                                                                
	// reference the tag "SentWhenDrunk" - using merge() ensures that it will be added to db if it didn't exist before
    tag = t4j.n.Tag('SentWhenDrunk').merge(),                   

	// connect the tag to all messages
    addTags = tag.relTo('Tagged', messages),                    

	// commit change to a dbset
    dbset = t4j.DbSet(me, group, members, addTags);             

	// send query to neo4j and handle the result
t4j.add(dbset, function (e, r) { /*...*/ });                    
```

## data types
there are a couple of defined data types that we use when interfacing with t4j:

_Node_ is used when adding or modifying data confined in nodes
example:
``` 
new t4j.Node('User', { id: 'id123', name: 'Bertil', occupation: 'Professional bowler' }});
```
example: 
```
new t4j.n.User('id123');
```

_Reference_ is used when a node needs to be referenced when modifying or adding other nodes or relations, such as "edit all User nodes related to Group node"
example: 
```
new t4j.Reference('Group', 'id123');
```
example: 
```
new t4j.ref.Group('id123');
```

_Relation_ is used to define relations between nodes and/or references in the query chain
example: 
```
node1.relTo('RelatesTo', node2);
```

_DbSet_ is the type used when committing changes to the database
example: 
```
new t4j.DbSet([node1, relation]);
t4j.add(dbset, function(e,r){ /*...*/ });
```

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

### TODO

* remove custom prototypes for compatibility
* merge from typecast to other standard casting library
* add support for the multiple-relations pattern (n.byRelation().from().andBy().to()...) on nodes - it's allready implemented on references because it's easier
* make unit tests
* find out whether the bug with multiple relations being added on double-matches is on my side or in neo4j (appears in the example "add tag to all messages sent by me to users in groups I am a member of" above)
* make it possible to use multiple indices for individual labels, instead of the current 1:1 relationship between the two
* implement support for directionless relations (ie. ()-[]-() type relations)