all: agent1 agent2


#
# Create Certificate Authority: ca1
# ('password' is used for the CA password.)
#
ca1-cert.pem: ca1.cnf
	openssl req -new -x509 -config ca1.cnf -keyout ca1-key.pem -out ca1-cert.pem


#
# agent1 is signed by ca1.
#

agent1: agent1-keys/cert.pem agent1-keys/ca-cert.pem agent1-verify

agent1-keys:
	mkdir -p agent1-keys

agent1-keys/key.pem: agent1-keys
	openssl genrsa -out agent1-keys/key.pem

agent1-keys/ca-cert.pem:
	cp ca1-cert.pem agent1-keys/ca-cert.pem

agent1-csr.pem: agent1.cnf agent1-keys/key.pem
	openssl req -new -config agent1.cnf -key agent1-keys/key.pem -out agent1-csr.pem

agent1-keys/cert.pem: agent1-csr.pem ca1-cert.pem ca1-key.pem
	openssl x509 -req \
		-passin "pass:password" \
		-in agent1-csr.pem \
		-CA ca1-cert.pem \
		-CAkey ca1-key.pem \
		-CAcreateserial \
		-out agent1-keys/cert.pem

agent1-verify: agent1-keys/cert.pem agent1-keys/ca-cert.pem
	openssl verify -CAfile agent1-keys/ca-cert.pem agent1-keys/cert.pem


#
# agent2 is signed by ca1.
#

agent2: agent2-keys/cert.pem agent2-keys/ca-cert.pem agent2-verify

agent2-keys:
	mkdir -p agent2-keys

agent2-keys/key.pem: agent2-keys
	openssl genrsa -out agent2-keys/key.pem

agent2-keys/ca-cert.pem:
	cp ca1-cert.pem agent2-keys/ca-cert.pem

agent2-csr.pem: agent2.cnf agent2-keys/key.pem
	openssl req -new -config agent2.cnf -key agent2-keys/key.pem -out agent2-csr.pem

agent2-keys/cert.pem: agent2-csr.pem ca1-cert.pem ca1-key.pem
	openssl x509 -req \
		-passin "pass:password" \
		-in agent2-csr.pem \
		-CA ca1-cert.pem \
		-CAkey ca1-key.pem \
		-CAcreateserial \
		-out agent2-keys/cert.pem

agent2-verify: agent2-keys/cert.pem agent2-keys/ca-cert.pem
	openssl verify -CAfile agent2-keys/ca-cert.pem agent2-keys/cert.pem




clean:
	rm -f *.pem *.srl
	rm -rf agent1-keys agent2-keys

test: agent1-verify


.PHONY: all clean test agent1-verify agent1 agent2-verify agent3-verify
