Galaxy brings `async/await` semantics to JavaScript with a minimal API, thanks to EcmaScript 6 generators.

## async/await in JavaScript

Galaxy lets you write async code as if JavaScript had [`async/await` keywords](http://msdn.microsoft.com/en-us/library/vstudio/hh191443.aspx).

For example, here is how you would write an async function that counts lines in a file:

``` javascript
function* countLines(path) {
	var names = yield fs.readdir(path);
	var total = 0;
	for (var i = 0; i < names.length; i++) {
		var fullname = path + '/' + names[i];
		if ((yield fs.stat(fullname)).isDirectory()) {
			total += yield countLines(fullname);
		} else {
			var count = (yield fs.readFile(fullname, 'utf8')).split('\n').length;
			console.log(fullname + ': ' + count);
			total += count;
		}
	}
	return total;
}
```

Just think of the `*` in `function*` as an `async` keyword and of `yield` as an `await` keyword.

You can write another async function that calls `countLines`:

``` javascript
function* projectLineCounts() {
	var total = 0;
	total += yield countLines(__dirname + '/../examples');
	total += yield countLines(__dirname + '/../lib');
	total += yield countLines(__dirname + '/../test');
	console.log('TOTAL: ' + total);
	return total;
}
```

Note: don't forget to prefix all the async calls with a `yield`. Otherwise you will be adding _generator_ objects to `total` and you'll just get a `NaN`.

Cool! But where does galaxy come into play? This is just plain JavaScript (with ES6 generators) and there are no calls to any `galaxy` API. Pretty mysterious!

That's the whole point behind galaxy: you hardly see it. It lets you write async functions that call other async functions with `function*` and `yield`. There are no extra API calls. Exactly like you would write your code if the language had `async/await` keywords.

## star/unstar

The magic happens in two places: when you call node.js async functions, and when node.js calls your async functions.

The node.js functions that we called in the example functions are `fs.readdir` and `fs.readFile`. Part of the magic is that `fs` is not your usual `require('fs')`. It is initialized as:

``` javascript
var galaxy = require('galaxy');
var fs = galaxy.star(require('fs'));
```

The `galaxy.star` call returns a module in which all the asynchronous functions have been _starred_, i.e. promoted from `function` to `function*`. When you call these functions with `yield` you get `await` semantics.

Note that `galaxy.star` can also be applied to individual functions. So, instead of _starring_ the entire `fs` module, we could have starred individual functions:

``` javascript
var galaxy = require('galaxy');
var fs = require('fs');
var readdir = galaxy.star(fs.readdir);
var readFile = galaxy.star(fs.readFile);
```

---

The other side of the magic happens when node.js calls your `function*` APIs. In our example, this happens when we call `projectLineCounts`, our main function. Here is the code:

``` javascript
var projectLineCountsCb = galaxy.unstar(projectLineCounts);

projectLineCountsCb(function(err, result) {
	if (err) throw err;
	console.log('CALLBACK RESULT: ' + result);
});
```

The `galaxy.unstar` call converts our `function*` into a regular node.js `function` that we then call with a callback.

`galaxy.unstar` can also be applied to a whole module, in which case it _unstars_ all the functions of the module. This is handy if you have written a library with galaxy and you want to make it available to developers who write their code in callback style. Just create another module that exports the _unstarred_ version of your functions:

``` javascript
var galaxy = require('galaxy');
module.exports = galaxy.unstar(require('my-starred-functions'));
```

Together, `galaxy.star` and `galaxy.unstar` take care of all the ugly work to make `*/yield` behave like `async/await`.

## Parallelizing

Fine. But all the code that we have seen above is completely sequential. Would be nice if we could parallelize some calls.

This is actually not very difficult: instead of _yielding_ on a generator returned by a _starred_ function you can _spin_ on it. This runs the generator in parallel with your other code and it gives you back a future. The future that you obtain is just another _starred_ function on which you can _yield_ later to get the result of the computation.

So, for example, you can parallelize the `projectLineCounts` operation by rewriting it as:

``` javascript
function* projectLineCountsParallel() {
 	var future1 = galaxy.spin(countLines(__dirname + '/../examples'));
 	var future2 = galaxy.spin(countLines(__dirname + '/../lib'));
	var future3 = galaxy.spin(countLines(__dirname + '/../test'));
 	var total = (yield future1()) + (yield future2()) + (yield future3());
	console.log('TOTAL: ' + total);
	return total; 
}
```

Note: this is not true parallelism; the futures only move forwards when execution reaches `yield` keywords in your code.

## Exception Handling

The usual exception handling keywords (`try/catch/finally/throw`) work as you would expect them to.

If an exception is thrown during the excution of a future, it is thrown when you _yield_ on the future, not when you start it with `galaxy.spin`.

## Long stacktrace

Galaxy provides long stacktraces. Here is a typical stacktrace:

```
Error: getaddrinfo ENOTFOUND
    <<< yield stack >>>
    at googleSearch (/Users/bruno/dev/syracuse/node_modules/galaxy/tutorial/tuto6-mongo.js:43:11)
    at search (/Users/bruno/dev/syracuse/node_modules/galaxy/tutorial/tuto6-mongo.js:30:34)
    at  (/Users/bruno/dev/syracuse/node_modules/galaxy/tutorial/tuto6-mongo.js:22:29)
    <<< raw stack >>>
    at errnoException (dns.js:37:11)
    at Object.onanswer [as oncomplete] (dns.js:124:16)
```

The `<<< yield stack >>>` part is a stack which has been reconstructed by the galaxy library and which reflects the stack of `yield` calls in your code. 

The `<<< raw stack >>>` part gives you the low level callback stack that triggered the exception. It is usually a lot less helpful than the _yield_ stack because it does not give you much context about the error.

This feature requires that you install the `galaxy-stack` module:

```
npm install galaxy-stack
```

## Asynchronous constructor

Galaxy also lets you invoke constructors that contain asynchronous calls but this is one of the rare cases where you cannot just use the usual JavaScript keyword. Instead of the `new` keyword you use the special `galaxy.new` helper. Here is an example:

``` javascript
// asynchronous constructor
function* MyClass(name) {
	this.name = name;
	yield myAsyncFn();
}

// create an instance of MyClass
var myObj = (yield galaxy.new(MyClass)("obj1"));
console.log(myObj.name);
```

## Stable context

Global variables are evil. Everyone knows that!

But there are a few cases where they can be helpful. 
The main one is to track information about _who_ is executing the current request: security context, locale, etc. This kind of information is usually very stable (for a given request) and it would be very heavy to pass it explicitly down to all the low level APIs that need it. So the best way is to pass it implicitly through some kind of global context.

But you need a special global which is preserved across _yield_ points. If you set it at the beginning of a request it should remain the same throughout the request (unless you change it explicitly). It should not change under your feet because other requests with different contexts get interleaved.

Galaxy exposes a `context` property that is guaranteed to be stable across yield points. If you assign an object to `galaxy.context` at the beginning of a request, you can retrieve it later.

Note: this functionality is more or less equivalent to Thread Local Storage (TLS) in threaded systems.

Gotcha: the context will be preserved if you write your logic in async/await style with galaxy, but you have to be careful if you start mixing sync style and callback style in your source code. You may break the propagation.

## Streams

Galaxy provides a simple API to work with node.js streams. The [galaxy/lib/server/streams](https://github.com/bjouhier/galaxy/blob/master/lib/server/streams.md) module contains wrappers for all the main streams of the node API, as well as generic `ReadableStream` and `WritableStream` wrappers.

Once you have wrapped a _readable_ stream, you can read from it with:

```
var data = yield stream.read(size);
```

The `size` parameter is optional. If you pass it and if the stream does not end prematurely, the `read` call returns a `string`/`Buffer` of exactly `size` characters / bytes, depending on whether an encoding has been set or not. If the stream ends before `size` characters / bytes, the remaining data is returned. If you try to read past the end of the stream, `null` is returned.

Without `size` argument, `read` returns the next chunk of data available from the stream, as a `string` or `Buffer` depending on encoding. It returns `null` at the end of the stream.

Readable streams also support a synchronous `unread(data)` method, which is handy for parsers.


Writable streams are similar. Once you have wrapped a _writable_ stream, you can write to it with:

```
yield stream.write(data, encoding);
```

Encoding is optional. For a binary stream, you do not pass any `encoding` and `data` is a `Buffer`. For a character stream, you must pass an `encoding` and `data` is a `string`. 

To end a stream, just write `null` or `undefined`. For example: `yield stream.write();`. You can also end it with a synchronous `stream.end()` call.

## API

See [API.md](API.md)

See also the [tutorial](tutorial/tutorial.md) and the [examples](examples).

## Installation

``` sh
$ npm install galaxy
$ npm install galaxy-stack
```

`galaxy-stack` is an optional module that you should install to get long stacktraces.

Then you can try the examples:

``` sh
$ cd node_modules/galaxy
$ node --harmony examples/countLines
... some output ...
$ node --harmony examples/countLinesParallel
... slightly different output  ...
```

## Running in the browser

Galaxy also runs browser side but you need a bleeding edge browser like the latest Google Chrome Canary that you can download from https://www.google.com/intl/en/chrome/browser/canary.html. 

Harmony generators are not turned on by default but the procedure to enable them is easy: open the chrome://flags page then check the "Enable Experimental JavaScript" option and restart Canary. You're all set and you can open the examples/hello-browser.html page to see Galaxy in action. Pretty boring demo but at least it works!

## Gotchas

Generators have been added very recently to V8. To use them you need to:

* Install node.js version 0.11.2 (unstable) or higher.
* Run node with the `--harmony` flag.

For example, to run the example above:

``` sh
$ node -v
v0.11.2
$ node --harmony examples/countLines
```

The yield keyword can be tricky because it has a very low precedence. For example you cannot write:

``` javascript
var sum1 = yield a() + yield b();
var sum2 = yield c() + 3;
```

because they get interpreted as:

``` javascript
var sum1 = yield (a() + yield b()); // compile error
var sum2 = yield (c() + 3); // galaxy gives runtime error
```

You have to write:

``` javascript
var sum = (yield a()) + (yield b());
var sum2 = (yield c()) + 3;
```

This brings a little lispish flavor to your JS code.


## More info

This design is strongly inspired from bits and pieces of [streamline.js](https://github.com/Sage/streamlinejs). The following blog articles are a bit old and not completely aligned on `galaxy` but they give a bit of background:

* [an early experiment with generators](http://bjouhier.wordpress.com/2012/05/18/asynchronous-javascript-with-generators-an-experiment/).
* [futures = currying the callback](http://bjouhier.wordpress.com/2011/04/04/currying-the-callback-or-the-essence-of-futures/)

## License

This work is licensed under the [MIT license](http://en.wikipedia.org/wiki/MIT_License).

