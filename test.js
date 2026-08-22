const array = [{id: 'c'}, {id: 'a'}, {id: 'b'}];
array.sort((a,b) => a.id.localeCompare(b.id));
console.log(array);
