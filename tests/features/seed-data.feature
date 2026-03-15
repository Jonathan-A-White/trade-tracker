Feature: Pre-populated Seed Data
  As a new user
  I want to pre-populate my item library with common products
  So that I don't have to manually enter every item

  Background:
    Given the app is loaded
    And I am on the Settings page

  # From commit: Add pre-populated PLU codes for common fruits and vegetables
  Scenario: Load PLU codes for common produce
    When I tap "Load PLU Codes"
    Then common fruit and vegetable PLU codes are loaded into the item library
    And items include produce like "Bananas (4011)", "Apples (4131)", etc.
    And each item has the correct PLU code as its barcode
    And unit type is set appropriately (each or per_lb)

  # From commit: Add ~56 organic produce PLU codes to seed data
  Scenario: Load organic produce PLU codes
    When I tap "Load PLU Codes"
    Then organic produce PLU codes are also loaded
    And organic items include entries like "Organic Bananas (94011)"
    And approximately 56 organic produce items are available

  # From commit: Add pre-populated PLU codes for common fruits and vegetables
  Scenario: PLU seed data does not overwrite existing items
    Given I have an existing item with barcode "4011" named "My Bananas"
    When I tap "Load PLU Codes"
    Then the existing item "My Bananas" is not overwritten
    And its name remains "My Bananas"

  # From commit: Add pre-populated Trader Joe's product barcodes
  Scenario: Load Trader Joe's product barcodes
    When I tap "Load TJ's Barcodes"
    Then popular Trader Joe's products are loaded into the item library
    And items include products with their retail barcodes
    And approximately 30 products are added

  # From commit: Add pre-populated Trader Joe's product barcodes
  Scenario: TJ's barcodes do not overwrite existing items
    Given I have an existing item with a Trader Joe's barcode
    When I tap "Load TJ's Barcodes"
    Then the existing item is not overwritten

  # From commit: Add grocery receipt parser: pre-populate items from TJ's receipt
  Scenario: Load items from sample Trader Joe's receipt
    When I tap "Load TJ's Receipt Items"
    Then items from a sample Trader Joe's receipt are loaded
    And each item includes name, barcode, price, and category
    And price history entries are created for the loaded items
    And approximately 40 receipt items are available

  # From commit: Add grocery receipt parser: pre-populate items from TJ's receipt
  Scenario: Receipt seed includes historical price data
    When I tap "Load TJ's Receipt Items"
    And I navigate to an item loaded from the receipt
    Then I see that the item has a price history entry
    And the price matches the receipt price
