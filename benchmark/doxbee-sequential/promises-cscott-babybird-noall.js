var Promise = require('../../');
global.useThisImpl = Promise;
require('../lib/fakesP');

module.exports = function upload(stream, idOrPath, tag, done) {
    var blob = blobManager.create(account);
    var tx = db.begin();
    var blobIdP = blob.put(stream);
    var fileP = self.byUuidOrPath(idOrPath).get();
    var version, fileId, file, blobId;

    blobIdP.then(function bench1(_blobId) {
        blobId = _blobId;
        return fileP;
    }).then(function bench2(fileV) {
        file = fileV;
        var previousId = file ? file.version : null;
        version = {
            userAccountId: userAccount.id,
            date: new Date(),
            blobId: blobId,
            creatorId: userAccount.id,
            previousId: previousId,
        };
        version.id = Version.createHash(version);
        return Version.insert(version).execWithin(tx);
    }).then(function bench3() {
        if (!file) {
            var splitPath = idOrPath.split('/');
            var fileName = splitPath[splitPath.length - 1];
            var newId = uuid.v1();
            return self.createQuery(idOrPath, {
                id: newId,
                userAccountId: userAccount.id,
                name: fileName,
                version: version.id
            }).then(function bench4(q) {
                return q.execWithin(tx);
            }).then(function bench5() {
                return newId;
            });
        } else {
            return file.id;
        }
    }).then(function bench6(fileIdV) {
        fileId = fileIdV;
        return FileVersion.insert({
            fileId: fileId,
            versionId: version.id
        }).execWithin(tx);
    }).then(function bench7() {
        return File.whereUpdate({id: fileId}, {version: version.id})
            .execWithin(tx);
    }).then(function bench8() {
        tx.commit();
        return done();
    }, function bench9(err) {
        tx.rollback();
        return done(err);
    });
}
