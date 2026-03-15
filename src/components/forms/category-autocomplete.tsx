import { useState, useRef, useEffect, useCallback } from "react";

const GROCERY_CATEGORIES = [
  "Bakery",
  "Beverages",
  "Breakfast & Cereal",
  "Canned Goods",
  "Condiments & Sauces",
  "Dairy & Eggs",
  "Deli",
  "Frozen Foods",
  "Grains, Pasta & Sides",
  "Health & Beauty",
  "Household & Cleaning",
  "International Foods",
  "Meat & Seafood",
  "Oils & Vinegars",
  "Paper & Plastic Goods",
  "Pet Supplies",
  "Produce",
  "Snacks & Candy",
  "Spices & Seasonings",
];

interface CategoryAutocompleteProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function CategoryAutocomplete({
  value,
  onChange,
  className,
}: CategoryAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const filtered = value
    ? GROCERY_CATEGORIES.filter((cat) =>
        cat.toLowerCase().includes(value.toLowerCase())
      )
    : GROCERY_CATEGORIES;

  const showDropdown = isOpen && filtered.length > 0;

  const selectItem = useCallback(
    (item: string) => {
      onChange(item);
      setIsOpen(false);
      setHighlightedIndex(-1);
    },
    [onChange]
  );

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Scroll highlighted item into view
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.children[highlightedIndex] as HTMLElement;
      item?.scrollIntoView({ block: "nearest" });
    }
  }, [highlightedIndex]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showDropdown) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        setIsOpen(true);
        e.preventDefault();
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filtered.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filtered.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0) {
          selectItem(filtered[highlightedIndex]);
        } else {
          setIsOpen(false);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
    }
  }

  return (
    <div ref={containerRef} className="relative">
      <input
        id="item-category"
        type="text"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setHighlightedIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onKeyDown={handleKeyDown}
        placeholder="e.g. Produce, Dairy & Eggs"
        className={className}
        autoComplete="off"
        role="combobox"
        aria-expanded={showDropdown}
        aria-autocomplete="list"
        aria-controls="category-listbox"
      />
      {showDropdown && (
        <ul
          id="category-listbox"
          ref={listRef}
          role="listbox"
          className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 py-1 shadow-lg"
        >
          {filtered.map((cat, index) => (
            <li
              key={cat}
              role="option"
              aria-selected={index === highlightedIndex}
              className={`cursor-pointer px-3 py-2 text-sm ${
                index === highlightedIndex
                  ? "bg-blue-600 text-white"
                  : "text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-600"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectItem(cat);
              }}
              onMouseEnter={() => setHighlightedIndex(index)}
            >
              {cat}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
