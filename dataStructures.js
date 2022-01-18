// Derived from
// https://github.com/wooorm/linked-list/blob/d2390fe1cab9f780cfd34fa31c8fa8ede4ad674d/index.js

// Creates a new `Iterator` for looping over the `List`.
class Iterator {
  constructor(item) {
    this.item = item;
  }

  // Move the `Iterator` to the next item.
  next() {
    this.value = this.item;
    this.done = !this.item;
    this.item = this.item ? this.item.next : undefined;
    return this;
  }
}

// Creates a new `Item`:
// An item is a bit like DOM node: It knows only about its “parent” (`list`),
// the item before it (`prev`), and the item after it (`next`).
var LinkedListItem = class Item {
  // Prepends the given item *before* the item operated on.
  prepend(item) {
    const list = this.list;

    if (!item || !item.append || !item.prepend || !item.detach) {
      throw new Error(
        'An argument without append, prepend, or detach methods was given to `Item#prepend`.',
      );
    }

    // If self is detached, return false.
    if (!list) {
      return false;
    }

    // Detach the prependee.
    item.detach();

    // If self has a previous item...
    if (this.prev) {
      item.prev = this.prev;
      this.prev.next = item;
    }

    // Connect the prependee.
    item.next = this;
    item.list = list;

    // Set the previous item of self to the prependee.
    this.prev = item;

    // If self is the first item in the parent list, link the lists first item to
    // the prependee.
    if (this === list.head) {
      list.head = item;
    }

    // If the the parent list has no last item, link the lists last item to self.
    if (!list.tail) {
      list.tail = this;
    }

    list.size++;
    list.idsToItems[item.getId()] = item;

    return item;
  }

  // Appends the given item *after* the item operated on.
  append(item) {
    const list = this.list;

    if (!item || !item.append || !item.prepend || !item.detach) {
      throw new Error(
        'An argument without append, prepend, or detach methods was given to `Item#append`.',
      );
    }

    if (!list) {
      return false;
    }

    // Detach the appendee.
    item.detach();

    // If self has a next item…
    if (this.next) {
      item.next = this.next;
      this.next.prev = item;
    }

    // Connect the appendee.
    item.prev = this;
    item.list = list;

    // Set the next item of self to the appendee.
    this.next = item;

    // If the the parent list has no last item or if self is the parent lists last
    // item, link the lists last item to the appendee.
    if (this === list.tail || !list.tail) {
      list.tail = item;
    }

    list.size++;
    list.idsToItems[item.getId()] = item;

    return item;
  }

  // Detaches the item operated on from its parent list.
  detach() {
    const list = this.list;

    if (!list) {
      return this;
    }

    // If self is the last item in the parent list, link the lists last item to
    // the previous item.
    if (list.tail === this) {
      list.tail = this.prev;
    }

    // If self is the first item in the parent list, link the lists first item to
    // the next item.
    if (list.head === this) {
      list.head = this.next;
    }

    // If both the last and first items in the parent list are the same, remove
    // the link to the last item.
    if (list.tail === list.head) {
      list.tail = null;
    }

    // If a previous item exists, link its next item to selfs next item.
    if (this.prev) {
      this.prev.next = this.next;
    }

    // If a next item exists, link its previous item to selfs previous item.
    if (this.next) {
      this.next.prev = this.prev;
    }

    // Remove links from self to both the next and previous items, and to the
    // parent list.
    this.prev = this.next = this.list = null;

    list.size--;
    delete list.idsToItems[this.getId()];

    return this;
  }
};

LinkedListItem.prototype.next =
  LinkedListItem.prototype.prev =
  LinkedListItem.prototype.list =
    null;

// Creates a new List: A linked list is a bit like an Array, but knows nothing
// about how many items are in it, and knows only about its first (`head`) and
// last (`tail`) items.
// Each item (e.g. `head`, `tail`, &c.) knows which item comes before or after
// it (its more like the implementation of the DOM in JavaScript).
var LinkedList = class List {
  // Creates a new list from the arguments (each a list item) passed in.
  static of(...items) {
    return appendAll(new this(), items);
  }

  // Creates a new list from the given array-like object (each a list item) passed
  // in.
  static from(items) {
    return appendAll(new this(), items);
  }

  constructor(...items) {
    appendAll(this, items);
    this.idsToItems = {};
  }

  // Returns the list’s items as an array.
  // This does *not* detach the items.
  toArray() {
    let item = this.head;
    const result = [];

    while (item) {
      result.push(item);
      item = item.next;
    }

    return result;
  }

  // Prepends the given item to the list.
  // `item` will be the new first item (`head`).
  prepend(item) {
    if (!item) {
      return false;
    }

    if (!item.append || !item.prepend || !item.detach) {
      throw new Error(
        'An argument without append, prepend, or detach methods was given to `List#prepend`.',
      );
    }

    if (this.head) {
      return this.head.prepend(item);
    }

    item.detach();
    item.list = this;
    this.head = item;
    this.size++;
    this.idsToItems[item.getId()] = item;

    return item;
  }

  // Appends the given item to the list.
  // `item` will be the new last item (`tail`) if the list had a first item, and
  // its first item (`head`) otherwise.
  append(item) {
    if (!item) {
      return false;
    }

    if (!item.append || !item.prepend || !item.detach) {
      throw new Error(
        'An argument without append, prepend, or detach methods was given to `List#append`.',
      );
    }

    // If self has a last item, defer appending to the last items append method,
    // and return the result.
    if (this.tail) {
      return this.tail.append(item);
    }

    // If self has a first item, defer appending to the first items append method,
    // and return the result.
    if (this.head) {
      return this.head.append(item);
    }

    // …otherwise, there is no `tail` or `head` item yet.
    item.detach();
    item.list = this;
    this.head = item;
    this.size++;
    this.idsToItems[item.getId()] = item;

    return item;
  }

  findById(id) {
    return this.idsToItems[id];
  }

  // Creates an iterator from the list.
  [Symbol.iterator]() {
    return new Iterator(this.head);
  }
};

LinkedList.prototype.size = 0;
LinkedList.prototype.tail = LinkedList.prototype.head = null;

// Creates a new list from the items passed in.
function appendAll(list, items) {
  let index;
  let item;
  let iterator;

  if (!items) {
    return list;
  }

  if (items[Symbol.iterator]) {
    iterator = items[Symbol.iterator]();
    item = {};

    while (!item.done) {
      item = iterator.next();
      list.append(item && item.value);
    }
  } else {
    index = -1;

    while (++index < items.length) {
      list.append(items[index]);
    }
  }

  return list;
}
