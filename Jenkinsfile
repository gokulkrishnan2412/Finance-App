pipeline {
    agent any

    environment {
        IMAGE_NAME = 'finance-app'
        CONTAINER_NAME = 'finance-app-ci'
    }

    stages {
        stage('Validate') {
            steps {
                sh 'python3 -m compileall -q backend'
            }
        }

        stage('Build Image') {
            steps {
                sh 'docker build --tag "$IMAGE_NAME:$BUILD_NUMBER" .'
            }
        }

        stage('Smoke Test') {
            steps {
                sh '''
                    docker run --detach --rm \
                        --name "$CONTAINER_NAME" \
                        --publish 5000:5000 \
                        "$IMAGE_NAME:$BUILD_NUMBER"

                    trap 'docker stop "$CONTAINER_NAME" >/dev/null 2>&1 || true' EXIT

                    for attempt in $(seq 1 30); do
                        if curl --fail --silent http://127.0.0.1:5000/get_lendings >/dev/null; then
                            exit 0
                        fi
                        sleep 1
                    done

                    echo 'Application did not become ready in time.'
                    exit 1
                '''
            }
        }
    }

    post {
        always {
            sh 'docker rmi "$IMAGE_NAME:$BUILD_NUMBER" >/dev/null 2>&1 || true'
        }
    }
}
