package clerkkey

import (
	"encoding/base64"
	"strings"
	"testing"

	"github.com/projectachilles/ProjectAchilles/installer/internal/dnsclass"
)

func pk(prefix, host string) string {
	return prefix + base64.StdEncoding.EncodeToString([]byte(host+"$"))
}

func pub(host, reg string, zones ...string) dnsclass.Result {
	return dnsclass.Result{Host: host, Registrable: reg, Kind: dnsclass.PublicDomain, ZoneCandidates: zones}
}

func hasSev(fs []Finding, sev, sub string) bool {
	for _, f := range fs {
		if f.Severity == sev && strings.Contains(f.Message, sub) {
			return true
		}
	}
	return false
}

func TestDecode(t *testing.T) {
	k, err := DecodePublishable(pk("pk_live_", "clerk.example.com"))
	if err != nil || !k.Live || k.FAPIHost != "clerk.example.com" {
		t.Fatalf("got %+v %v", k, err)
	}
	// no padding
	raw := strings.TrimRight(pk("pk_test_", "clerk.a.b"), "=")
	k, err = DecodePublishable(raw)
	if err != nil || k.Live || k.FAPIHost != "clerk.a.b" {
		t.Fatalf("nopad: %+v %v", k, err)
	}
	for _, bad := range []string{"", "pk_x_abc", "pk_live_!!!", pk("pk_live_", ""), "pk_live_" + base64.StdEncoding.EncodeToString([]byte("nodollar"))} {
		if _, err := DecodePublishable(bad); err == nil {
			t.Errorf("expected error for %q", bad)
		}
	}
}

func TestFitTenantSubdomainStyleAccepted(t *testing.T) {
	r := pub("acme.projectachilles.io", "projectachilles.io", "acme.projectachilles.io", "projectachilles.io")
	if fs := CheckFit(pk("pk_live_", "clerk.acme.projectachilles.io"), "sk_live_x", r); len(fs) != 0 {
		t.Fatalf("%+v", fs)
	}
}

func TestFitParentDomainAccepted(t *testing.T) {
	r := pub("achilles.corp.example.com", "example.com", "achilles.corp.example.com", "corp.example.com", "example.com")
	if fs := CheckFit(pk("pk_live_", "clerk.example.com"), "sk_live_x", r); len(fs) != 0 {
		t.Fatalf("%+v", fs)
	}
}

func TestFitAboveRegistrableRejected(t *testing.T) {
	r := pub("a.example.co.uk", "example.co.uk", "a.example.co.uk", "example.co.uk")
	if fs := CheckFit(pk("pk_live_", "clerk.co.uk"), "sk_live_x", r); !hasSev(fs, "error", "clerk.co.uk") {
		t.Fatalf("%+v", fs)
	}
}

func TestFitForeignDomainError(t *testing.T) {
	r := pub("achilles.corp.example.com", "example.com", "achilles.corp.example.com", "corp.example.com", "example.com")
	fs := CheckFit(pk("pk_live_", "clerk.other.com"), "sk_live_x", r)
	want := "This production key belongs to clerk.other.com, but the server name achilles.corp.example.com needs a Clerk app on one of: clerk.achilles.corp.example.com, clerk.corp.example.com, clerk.example.com."
	if !hasSev(fs, "error", want) {
		t.Fatalf("%+v", fs)
	}
}

func TestFitLiveOnPrivateError(t *testing.T) {
	r := dnsclass.Result{Host: "achilles.corp", Registrable: "achilles.corp", Kind: dnsclass.PrivateOnly}
	fs := CheckFit(pk("pk_live_", "clerk.example.com"), "sk_live_x", r)
	if !hasSev(fs, "error", "public domain") || !hasSev(fs, "error", "development") {
		t.Fatalf("%+v", fs)
	}
}

func TestFitTestOnPublicWarn(t *testing.T) {
	r := pub("a.example.com", "example.com", "a.example.com", "example.com")
	fs := CheckFit(pk("pk_test_", "foo-12.clerk.accounts.dev"), "sk_test_x", r)
	if len(fs) != 1 || fs[0].Severity != "warn" || !strings.Contains(fs[0].Message, "production") {
		t.Fatalf("%+v", fs)
	}
}

func TestFitTestOnPrivateOK(t *testing.T) {
	r := dnsclass.Result{Host: "a.lan", Registrable: "a.lan", Kind: dnsclass.PrivateOnly}
	if fs := CheckFit(pk("pk_test_", "foo-12.clerk.accounts.dev"), "sk_test_x", r); len(fs) != 0 {
		t.Fatalf("%+v", fs)
	}
}

func TestFitMixedEnvironmentsError(t *testing.T) {
	r := pub("a.example.com", "example.com", "a.example.com", "example.com")
	if fs := CheckFit(pk("pk_live_", "clerk.a.example.com"), "sk_test_x", r); !hasSev(fs, "error", "different") {
		t.Fatalf("%+v", fs)
	}
	if fs := CheckFit(pk("pk_test_", "x.clerk.accounts.dev"), "sk_live_x", r); !hasSev(fs, "error", "different") {
		t.Fatalf("%+v", fs)
	}
}

func TestFitBadSecretPrefixAndEmpty(t *testing.T) {
	r := pub("a.example.com", "example.com", "a.example.com", "example.com")
	if fs := CheckFit(pk("pk_live_", "clerk.a.example.com"), "abc", r); !hasSev(fs, "error", "sk_live_") {
		t.Fatalf("%+v", fs)
	}
	fs := CheckFit("", "", r)
	if !hasSev(fs, "error", "publishable key is required") || !hasSev(fs, "error", "secret key is required") {
		t.Fatalf("%+v", fs)
	}
}

func TestFitTrimsWhitespace(t *testing.T) {
	r := pub("a.example.com", "example.com", "a.example.com", "example.com")
	if fs := CheckFit(" "+pk("pk_live_", "clerk.a.example.com")+"\n", "sk_live_x\n", r); len(fs) != 0 {
		t.Fatalf("%+v", fs)
	}
}

func TestDecodeRejectsMalformedHost(t *testing.T) {
	for name, payload := range map[string]string{
		"control": "a\x1b[31m.com$", "nul": "a\x00.com$", "newline": "a\n.com$",
		"utf8": "a\xff\xfe.com$", "dollar": "a$b$", "emptylabel": "a..com$",
	} {
		for _, pre := range []string{"pk_test_", "pk_live_"} {
			_, err := DecodePublishable(pre + base64.StdEncoding.EncodeToString([]byte(payload)))
			if err == nil || strings.Contains(err.Error(), "\x1b") || !strings.Contains(err.Error(), "not a valid host name") {
				t.Errorf("%s/%s: err=%v", name, pre, err)
			}
		}
	}
}

func TestDecodeNormalisesHost(t *testing.T) {
	k, err := DecodePublishable(pk("pk_live_", "Clerk.Example.COM."))
	if err != nil || k.FAPIHost != "clerk.example.com" {
		t.Fatalf("%+v %v", k, err)
	}
}
