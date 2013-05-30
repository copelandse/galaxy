var galaxy = require('galaxy');
var fs = require('fs');
var readdirStar = galaxy.star(fs.readdir);
var readFileStar = galaxy.star(fs.readFile);

function* countLinesStar(path) {
	var names = yield readdirStar(path);
	var total = 0;
	for (var i = 0; i < names.length; i++) {
		var fullname = path + '/' + names[i];
		var count = (yield readFileStar(fullname, 'utf8')).split('\n').length;
		console.log(fullname + ': ' + count);
		total += count;
	}
	return total;
}

function* projectLineCountsStar() {
	var total = 0;
	total += yield countLinesStar(__dirname + '/../examples');
	total += yield countLinesStar(__dirname + '/../lib');
	total += yield countLinesStar(__dirname + '/../test');
	console.log('TOTAL: ' + total);
	return total;
}

var projectLineCountsCb = galaxy.unstar(projectLineCountsStar);

projectLineCountsCb(function(err, result) {
	if (err) throw err;
	console.log('CALLBACK RESULT: ' + result);
});
