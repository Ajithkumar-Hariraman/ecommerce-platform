FROM quay.io/keycloak/keycloak:26.7.4 AS build
ENV KC_DB=postgres KC_HEALTH_ENABLED=true KC_METRICS_ENABLED=true KC_HTTP_RELATIVE_PATH=/auth
RUN /opt/keycloak/bin/kc.sh build
FROM quay.io/keycloak/keycloak:26.7.4
COPY --from=build /opt/keycloak/ /opt/keycloak/
COPY infra/aws/keycloak/ecommerce-realm.json /opt/keycloak/data/import/ecommerce-realm.json
COPY apps/api/certs/rds-ap-south-1-bundle.pem /opt/keycloak/conf/rds-ca.pem
ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
