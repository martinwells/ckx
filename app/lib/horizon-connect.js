import jPath from 'json-path'
import Queue from 'async-function-queue'
import equal from 'deep-equal'
  
// begins listening to specific db, returns path object.
// path object should be passed to all functions
// store: redux store object
// pathStr: string, like "/users" to sync (JPath)
// dbname: pouchDb name to sync with (local and external)
// actionPrefix: will emit redux actions INSERT_ENTRY, UPDATE_ENTRY, DELETE_ENTRY and INITIALIZE_ENTRY
export default (horizon, store, pathStr, dbname, actionPrefix = 'ENTRY') => {
  const pathObj = {
    path: pathStr,
    dbname: dbname,
    queue: Queue(1),
    actionPrefix: actionPrefix,
    docs: {},
    db: horizon(dbname),
    store: store
  }

  listenHorizon(pathObj)
  store.subscribe(e => processNewState(pathObj, store.getState()))

  console.log("Subscription to " + pathStr + " started")

  return pathObj
}

// begins listening to a specific database, returns object with cancel function
const listenHorizon = (path) => {
  path.db.watch({ rawChanges: true }).forEach( (e) => { onDbChange(path, e) } )
}

function processNewState(path, state) {
  var docs = jPath.resolve(state, path.path)[0];

  if (docs && docs.length) {
    var diffs = differences(path.docs, docs);
    if(!(diffs.updated.length == 0 && diffs.new.length == 0 && diffs.deleted.length == 0)) {
      console.log("DIFFS: ",diffs)

      const updated = diffs.new.concat(diffs.updated)
      if (updated.length > 0) {
        path.db.upsert(updated).forEach(
          (doc) => { console.log("Horizon stored doc", doc) }, 
            (error) => { console.log("Error storing doc",error) } 
        )
      }

      diffs.deleted.forEach(doc => scheduleRemove(path, doc))
    };
  }
}

  function scheduleInsert(path, doc) {
    console.log('redux->horizon insert', path, doc)
    path.docs[doc.id] = doc;
    path.db.store(doc).forEach((doc) => {console.log("Horizon stored doc", doc)}, (error) => {console.error("Error storing doc",doc,error)} )
  }

  function scheduleRemove(path, doc) {
    console.log('redux->horizon remove')
    delete path.docs[doc.id];
    var db = path.db;
    path.db.remove(doc).forEach((doc) => {console.log("Horizon removed doc", doc)}, (error) => {console.error("Error removing doc",doc,error)} )
  }

  function propagateDelete(path, doc) {
    console.log("horizon->redux remove", doc)
    path.store.dispatch({type: "DBDELETE_" + path.actionPrefix, id: doc.id})
  }

  function propagateInsert(path, doc) {
    console.log("horizon->redux inserting", doc)
    path.store.dispatch({type: "DBINSERT_" + path.actionPrefix, doc: doc})
  }

  function propagateUpdate(path, doc) {
    console.log("horizon->redux updating", doc)
    path.store.dispatch({type: "DBUPDATE_" + path.actionPrefix, doc: doc})
  }

function differences(oldDocs, newDocs) {
  var result = {
    new: [],
    updated: [],
    deleted: Object.keys(oldDocs).map(oldDocId => oldDocs[oldDocId]),
  };

  newDocs.forEach(function(newDoc) {
    var id = newDoc.id;

    if (! id) {
      console.warn('doc with no id');
    }
    result.deleted = result.deleted.filter(doc => doc.id !== id);
    var oldDoc = oldDocs[id];
    if (! oldDoc) {
      result.new.push(newDoc);
    } else if (!equal(oldDoc, newDoc)) {
      result.updated.push(newDoc);
    }
  });

  return result;
}

function onDbChange(path, change) {
  switch(change.type) {
    case 'initial':
    case 'add':
      path.docs[change.new_val.id] = change.new_val
      propagateInsert(path, change.new_val)
      break
    case 'remove':
      delete path.docs[change.old_val.id];
      propagateDelete(path, change.old_val);
      break
    case 'change':
      path.docs[change.new_val.id] = change.new_val
      propagateUpdate(path, change.new_val)
      break
    default:
  }
}

