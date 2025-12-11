module github.com/f0rtika/edrsilencer_test

go 1.21

require (
	github.com/preludeorg/libraries/go/tests/dropper v0.0.0
	github.com/preludeorg/libraries/go/tests/endpoint v0.0.0
)

replace (
	github.com/preludeorg/libraries/go/tests/dropper => /Users/jimx/Documents/F0RT1KA/f0_test_library/preludeorg-libraries/go/tests/dropper
	github.com/preludeorg/libraries/go/tests/endpoint => /Users/jimx/Documents/F0RT1KA/f0_test_library/preludeorg-libraries/go/tests/endpoint
)

// In a real setup, these would point to the actual locations of the libraries 